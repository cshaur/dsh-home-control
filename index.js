import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import dgram from 'node:dgram'

console.error('[JARVIS] Core Engine Initializing...')

let defineTool = (x) => x
try { const m = await import('@deepseek-ai/dsh-tools'); if (m.defineTool) defineTool = m.defineTool } catch {}

export const name = 'dsh-home-control'
export const inject = ['tools']

const CONFIG_PATH = join(homedir(), '.dsh', 'jarvis-config.json')

// Bulletproof: English + Emoji only to prevent Windows ANSI encoding crashes
const DEFAULT_MODES = { 'Sleep': [], 'Comfort': [], 'Away': [], 'Romantic': [] }
const MODE_ICONS = { 'Sleep': '🌙', 'Comfort': '🛋️', 'Away': '🏯', 'Romantic': '💕' }
const modeIcon = (n) => MODE_ICONS[n] || '⚙️'

async function loadConfig() {
  try {
    const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
    return cfg
  } catch (e) { 
    return { devices: [], modes: {}, customDrivers: {}, error: e.message } 
  }
}

async function saveConfig(cfg) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
}

// Universal HTTP Bridge: Control ANY WiFi device with an HTTP endpoint
async function universalControl(dev, action) {
  const urlTemplate = dev.urls?.[action]
  if (!urlTemplate) return `⚠️ No URL defined for action: ${action}`
  
  try {
    const r = await fetch(urlTemplate, { 
      method: dev.method || 'GET',
      signal: AbortSignal.timeout(5000)
    })
    return `${r.ok ? '✅' : '⚠️'} [HTTP] ${dev.name} ${action} -> ${r.status}`
  } catch (e) {
    return `⚠️ [HTTP] Failed to reach ${dev.name}: ${e.message}`
  }
}

// LAN Radar: Discover WiFi devices via UDP Broadcast (SSDP/Custom)
async function scanLAN(timeout = 3000) {
  return new Promise((res) => {
    const s = dgram.createSocket('udp4')
    const found = []
    const timer = setTimeout(() => { try { s.close() } catch {} res(found) }, timeout)
    s.on('error', () => { clearTimeout(timer); try { s.close() } catch {} res(found) })
    s.on('message', (m, rinfo) => { 
      found.push({ ip: rinfo.address, port: rinfo.port, payload: m.toString() }) 
    })
    s.bind(0, () => { 
      try {
        s.setBroadcast(true)
        // Send a generic discovery packet to common IoT ports
        s.send(Buffer.from('DISCOVER_JARVIS'), 8080, '255.255.255.255') 
      } catch {} 
    })
  })
}

function formatSetting(s) {
  const { device, state, ...rest } = s
  const parts = [state || 'on']
  Object.entries(rest).forEach(([k, v]) => parts.push(`${k}=${v}`))
  return parts.join(', ')
}

async function applyMode(cfg, name) {
  const modes = { ...DEFAULT_MODES, ...(cfg.modes || {}) }
  const settings = modes[name]
  if (!settings || !settings.length) return `⚠️ Mode "${name}" is empty. Use home_mode set to add devices.`
  
  const rs = []
  for (const s of settings) {
    const dev = cfg.devices.find(d => d.name === s.device)
    if (!dev) { rs.push(`  ⚠️ Device not found: ${s.device}`); continue }
    const r = await universalControl(dev, s.state)
    rs.push('  ' + r)
  }
  return `🎛️ Mode "${name}" Executed:\n${rs.join('\n')}`
}

export function apply(ctx) {
  console.error('[JARVIS] Tools Registering...')
  const reg = (tool) => {
    const tries = [
      () => ctx.tools.register(tool),
      () => ctx.registerTool(tool),
      () => ctx.get('tools').register(tool)
    ]
    for (const f of tries) { try { return f() } catch (e) {} }
  }

  reg(defineTool({
    name: 'home_discover',
    description: 'Scan local WiFi network for smart devices (LAN Radar).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const devices = await scanLAN()
      if (!devices.length) return '📡 No devices responded to LAN broadcast. Ensure devices are on the same WiFi.'
      return `📡 Discovered ${devices.length} WiFi endpoints:\n` + devices.map(d => `- IP: ${d.ip} | Port: ${d.port}`).join('\n')
    }
  }))

  reg(defineTool({
    name: 'home_bind',
    description: 'Bind a WiFi device to JARVIS using its HTTP API URL. (name: string, ip: string, on_url: string, off_url: string)',
    parameters: { 
      name: { type: 'string', required: true }, 
      ip: { type: 'string', required: true },
      on_url: { type: 'string', required: true },
      off_url: { type: 'string', required: true }
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const cfg = await loadConfig()
      const newDev = { 
        name: args.name, 
        ip: args.ip, 
        driver: 'universal_http',
        urls: { on: args.on_url, off: args.off_url } 
      }
      cfg.devices = cfg.devices || []
      cfg.devices.push(newDev)
      await saveConfig(cfg)
      return `✅ Bound "${args.name}" (${args.ip}) to JARVIS successfully!`
    }
  }))

  reg(defineTool({
    name: 'home_mode',
    description: 'Manage & Execute JARVIS Modes (Sleep/Comfort/Away/Romantic). action: list|apply|set',
    parameters: {
      action: { type: 'string', required: true },
      mode: { type: 'string' }, device: { type: 'string' }, state: { type: 'string' }
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const cfg = await loadConfig()
      const modes = cfg.modes || (cfg.modes = {})
      if (args.action === 'list') {
        const all = { ...DEFAULT_MODES, ...modes }
        return Object.entries(all).map(([n, l]) => 
          `${modeIcon(n)} ${n}: ${l.length ? l.map(x => x.device).join(', ') : '(Empty)'}`
        ).join('\n')
      }
      if (args.action === 'apply') return await applyMode(cfg, args.mode)
      if (args.action === 'set') {
        if (!args.mode || !args.device) return '⚠️ Need mode and device'
        const list = modes[args.mode] || (modes[args.mode] = [])
        list.push({ device: args.device, state: args.state || 'on' })
        await saveConfig(cfg)
        return `✅ Added ${args.device} to mode ${args.mode}`
      }
    }
  }))
}
