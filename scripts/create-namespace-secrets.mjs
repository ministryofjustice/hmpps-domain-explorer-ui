#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class CliError extends Error {}
const defaultValuesPath = path.resolve(__dirname, '../helm_deploy/hmpps-domain-explorer-ui/values.yaml')

function usage() {
  console.log(`Usage:
  node scripts/create-namespace-secrets.mjs <namespace> [--values-file <path>] [--name <secret-name>] [--value <string>] [--dry-run] [--rotate]

Options:
  --values-file <path>   Path to Helm values file (default: helm_deploy/hmpps-domain-explorer-ui/values.yaml)
  --name <secret-name>   Process only the named secret from namespace_secrets
  --value <string>       Set a specific value for the named secret (single-key secrets only)
  --dry-run              Print generated secret values but do not call kubectl
  --rotate               Rotate existing secrets (default: keep existing values)
`)
}

function parseArgs(argv) {
  const args = argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage()
    process.exit(args.length === 0 ? 1 : 0)
  }

  const namespace = args[0]
  let valuesFile = defaultValuesPath
  let name = null
  let value = null
  let dryRun = false
  let rotate = false

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--rotate') {
      rotate = true
      continue
    }

    if (arg === '--values-file') {
      const next = args[i + 1]
      if (!next) {
        throw new CliError('Missing value after --values-file')
      }
      valuesFile = path.resolve(next)
      i += 1
      continue
    }

    if (arg === '--name') {
      const next = args[i + 1]
      if (!next) {
        throw new CliError('Missing value after --name')
      }
      name = next
      i += 1
      continue
    }

    if (arg === '--value') {
      const next = args[i + 1]
      if (!next) {
        throw new CliError('Missing value after --value')
      }
      value = next
      i += 1
      continue
    }

    if (!arg.startsWith('-')) {
      throw new CliError(`Unexpected argument "${arg}". If your namespace contains spaces, wrap it in quotes.`)
    }

    throw new CliError(`Unknown argument: ${arg}`)
  }

  if (value !== null && !name) {
    throw new CliError('--value can only be used together with --name')
  }

  return { namespace, valuesFile, name, value, dryRun, rotate }
}

function applyExplicitValue(secretName, keyValues, value) {
  const keys = Object.keys(keyValues)

  if (keys.length !== 1) {
    throw new CliError(
      `--value can only be used with a single-key secret. Secret "${secretName}" has keys: ${keys.join(', ')}`,
    )
  }

  return { [keys[0]]: value }
}

function parseNamespaceSecrets(yamlText) {
  const lines = yamlText.split(/\r?\n/)
  const sectionIndex = lines.findIndex(line => /^\s*namespace_secrets:\s*$/.test(line))

  if (sectionIndex === -1) {
    throw new Error('Could not find namespace_secrets section in values file')
  }

  const baseIndent = (lines[sectionIndex].match(/^\s*/) || [''])[0].length
  const result = {}
  let currentSecret = null

  for (let i = sectionIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const indent = (line.match(/^\s*/) || [''])[0].length
    if (indent <= baseIndent) {
      break
    }

    if (indent === baseIndent + 2) {
      const match = line.match(/^\s*["']?([a-zA-Z0-9._-]+)["']?:\s*$/)
      if (!match) {
        currentSecret = null
        continue
      }

      currentSecret = match[1]
      result[currentSecret] = {}
      continue
    }

    if (indent >= baseIndent + 4 && currentSecret) {
      const kvMatch = line.match(/^\s*([A-Z0-9_]+):\s*["']?([^"']+)["']?\s*$/)
      if (!kvMatch) {
        continue
      }

      const envVarName = kvMatch[1]
      const secretKeyName = kvMatch[2]
      result[currentSecret][secretKeyName] = generateValue(envVarName, secretKeyName, currentSecret)
    }
  }

  return result
}

function randomString(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

function generateValue(envVarName, secretKeyName, secretName) {
  const key = `${envVarName} ${secretKeyName}`.toLowerCase()

  if (key.includes('endpoint_address') || key.includes('redis_host') || key.includes(' host')) {
    return `${secretName}.example.local`
  }

  if (key.includes('queue_url')) {
    return `https://sqs.eu-west-2.amazonaws.com/000000000000/${secretName}`
  }

  if (key.includes('client_id')) {
    return `client-${randomString(10)}`
  }

  if (
    key.includes('client_secret') ||
    key.includes('session_secret') ||
    key.includes('auth_token') ||
    key.includes('token') ||
    key.includes('secret')
  ) {
    return randomString(32)
  }

  return randomString(20)
}

function runKubectl(args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options
  const result = spawnSync('kubectl', args, {
    encoding: 'utf8',
    ...spawnOptions,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr || `kubectl ${args.join(' ')} failed`)
  }

  return result.stdout
}

function secretExists(namespace, secretName) {
  const result = spawnSync('kubectl', ['-n', namespace, 'get', 'secret', secretName], {
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  // kubectl returns 0 when the secret exists and non-zero when not found.
  return result.status === 0
}

function applySecret(namespace, secretName, keyValues, dryRun, rotate) {
  const fromLiteralArgs = Object.entries(keyValues).flatMap(([key, value]) => [`--from-literal=${key}=${value}`])
  const exists = secretExists(namespace, secretName)

  if (exists && !rotate) {
    console.log(
      dryRun ? `\n[DRY RUN] Would skip existing secret ${secretName}` : `Skipped existing secret ${secretName}`,
    )
    return 'skipped'
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] ${exists ? 'Would rotate' : 'Would create'} ${secretName}`)
    Object.entries(keyValues).forEach(([key, value]) => {
      console.log(`  ${key}=${value}`)
    })
    return exists ? 'rotated' : 'created'
  }

  const yaml = runKubectl([
    '-n',
    namespace,
    'create',
    'secret',
    'generic',
    secretName,
    ...fromLiteralArgs,
    '--dry-run=client',
    '-o',
    'yaml',
  ])

  runKubectl(['apply', '-f', '-'], { input: yaml })
  console.log(`${exists ? 'Rotated' : 'Created'} secret ${secretName} in namespace ${namespace}`)
  return exists ? 'rotated' : 'created'
}

function main() {
  const { namespace, valuesFile, name, value, dryRun, rotate } = parseArgs(process.argv)
  let valuesText
  try {
    valuesText = readFileSync(valuesFile, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new CliError(`Values file not found: ${valuesFile}`)
    }
    throw error
  }
  const secrets = parseNamespaceSecrets(valuesText)

  if (name && !secrets[name]) {
    const available = Object.keys(secrets).join(', ')
    throw new CliError(`Secret "${name}" not found in namespace_secrets. Available: ${available}`)
  }

  const selectedSecrets = name ? { [name]: secrets[name] } : secrets

  if (name && value !== null) {
    selectedSecrets[name] = applyExplicitValue(name, selectedSecrets[name], value)
  }

  const entries = Object.entries(selectedSecrets).filter(([, value]) => value && Object.keys(value).length > 0)
  if (entries.length === 0) {
    throw new CliError('No secrets found under namespace_secrets')
  }

  const stats = { created: 0, rotated: 0, skipped: 0 }

  entries.forEach(([secretName, keyValues]) => {
    const action = applySecret(namespace, secretName, keyValues, dryRun, rotate)
    if (action) {
      stats[action] += 1
    }
  })

  console.log(`\nProcessed ${entries.length} secret${entries.length === 1 ? '' : 's'} from ${valuesFile}`)
  if (name) {
    console.log(`Targeted secret: ${name}`)
  }
  console.log(`Created: ${stats.created}, Rotated: ${stats.rotated}, Skipped: ${stats.skipped}`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Error: ${message}`)
  if (error instanceof CliError) {
    console.error('')
    usage()
  }
  process.exit(1)
}
