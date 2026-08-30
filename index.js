import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import dgram from 'node:dgram'
import crypto from 'node:crypto'

console.error('[JARVIS] Core Engine Initializing...')

let defineTool = (x) => x
try { const m = await import('@deepseek-ai/dsh-tools'); if (m.defineTool) defineTool = m.defineTool } catch {}

export const name = 'dsh-home-control'
export const inject = ['tools']

const CONFIG_PATH = join(homedir(), '.dsh', 'home-control.json')
const DEFAULT_MODES = { Sleep: [], Comfort: [], Away: [], Romantic: [] }
const MODE_ICONS = { Sleep: '🌙', Comfort: '🛋️', Away: '🏯', Romantic: '💕' }
const icon = (n) => MODE_ICONS[n] || '⚙️'

async function load() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) }
  catch (e) { return { devices: [], modes: {}, error: e.message } }
}
async function save(cfg) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
}

async function fire(dev, action) {
  if (dev.driver === 'demo') return `✅ [DEMO] ${dev.name} ${action.toUpperCase()}`
  const url = dev.urls?.[action]
  if (!url) return `⚠️ ${dev.name}: no URL for ${action}`
  try {
    const r = await fetch(url, { method: dev.method || 'GET', signal: AbortSignal.timeout(5000) })
    return `${r.ok ? '✅' : '⚠️'} ${dev.name} ${action} -> ${r.status}`
  } catch (e) { return `⚠️ ${dev.name}: ${e.message}` }
}

const fmt = (s) => { const { device, state, ...r } = s; return [state || 'on', ...Object.entries(r).map(([k, v]) => `${k}=${v}`)].join(', ') }

async function dashboard(cfg) {
  const modes = { ...DEFAULT_MODES, ...(cfg.modes || {}) }
  let md = '## 🏠 Smart Home Dashboard\n\n'
  for (const [n, l] of Object.entries(modes)) {
    md += `### ${icon(n)} ${n}\n`
    md += l.length ? '| Device | Settings |\n|---|---|\n' + l.map(s => `| ${s.device} | ${fmt(s)} |\n`).join('') + '\n' : '(empty)\n\n'
  }
  md += '### 📱 Devices\n| Device | Driver | Bind |\n|---|---|---|\n'
  for (const d of cfg.devices) md += `| ${d.name} | ${d.driver || 'http'} | ${d.urls?.on || d.driver === 'demo' ? '🟢' : '🔴'} |\n`
  return md
}

function ssdp(t = 4000) {
  return new Promise((res) => {
    const s = dgram.createSocket('udp4'); const found = new Map()
    const done = () => { try { s.close() } catch {} res([...found.values()]) }
    const timer = setTimeout(done, t)
    s.on('error', () => { clearTimeout(timer); done() })
    s.on('message', (m, r) => { try {
      const txt = m.toString()
      const st = (txt.match(/ST:\s*(.+)/i) || [])[1] || 'unknown'
      const sv = (txt.match(/SERVER:\s*(.+)/i) || [])[1] || ''
      if (!found.has(r.address)) found.set(r.address, { ip: r.address, type: st.split(':').pop().trim(), server: sv.trim() })
    } catch {} })
    s.bind(0, () => { try {
      s.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: ssdp:all\r\n\r\n'), 1900, '239.255.255.250')
    } catch {} })
  })
}

const GREE_KEY = 'a3K8Bx%2r8Y7#3h%'
function gree(t = 2500) {
  const dec = (data) => { const c = crypto.createDecipheriv('aes-128-ecb', Buffer.from(GREE_KEY), null); return Buffer.concat([c.update(data), c.final()]) }
  return new Promise((res) => {
    const s = dgram.createSocket('udp4'); const found = []
    const timer = setTimeout(() => { try { s.close() } catch {} res(found) }, t)
    s.on('error', () => { clearTimeout(timer); try { s.close() } catch {} res(found) })
    s.on('message', (m) => { try {
      const j = JSON.parse(m.toString())
      if (j.t === 'pack' && j.pack) found.push({ ip: JSON.parse(dec(Buffer.from(j.pack, 'base64')).toString()).ip })
    } catch {} })
    s.bind(0, () => { try { s.setBroadcast(true); s.send(Buffer.from(JSON.stringify({ t: 'scan' })), 7000, '255.255.255.255') } catch {} })
  })
}

export function apply(ctx) {
  console.error('[JARVIS] Registering tools...')
  const reg = (t) => { for (const f of [() => ctx.tools.register(t), () => ctx.registerTool(t), () => ctx.get('tools').register(t)]) { try { return f() } catch (e) {} } }

  reg(defineTool({
    name: 'home_discover',
    description: 'Multi-protocol LAN radar: SSDP/UPnP (TVs, speakers) + Gree (AC).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const [u, g] = await Promise.all([ssdp(), gree()])
      let md = '📡 JARVIS LAN Radar\n\n### UPnP/SSDP\n'
      md += u.length ? '| IP | Type | Server |\n|---|---|---|\n' + u.map(d => `| ${d.ip} | ${d.type} | ${d.server} |\n`).join('') : '(none)\n'
      md += '\n### Gree AC\n'
      md += g.length ? g.map(x => `- ${x.ip}\n`).join('') : '(none)\n'
      md += '\n💡 Bind any device with home_bind (name + on_url + off_url).'
      return md
    }
  }))

  reg(defineTool({
    name: 'home_dashboard',
    description: 'Render the smart-home dashboard (modes + devices).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() { return dashboard(await load()) }
  }))

  reg(defineTool({
    name: 'home_bind',
    description: 'Bind any WiFi device by HTTP URLs. (name, on_url, off_url)',
    parameters: { name: { type: 'string', required: true }, on_url: { type: 'string', required: true }, off_url: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(a) {
      const cfg = await load()
      cfg.devices = cfg.devices || []
      cfg.devices.push({ name: a.name, driver: 'http', urls: { on: a.on_url, off: a.off_url } })
      await save(cfg)
      return `✅ Bound "${a.name}" to JARVIS!`
    }
  }))

  reg(defineTool({
    name: 'home_control',
    description: 'Control a bound device. action: on|off; target: device name.',
    parameters: { action: { type: 'string', required: true }, target: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(a) {
      const cfg = await load()
      const dev = cfg.devices.find(d => d.name === a.target)
      if (!dev) return `⚠️ Not found: ${a.target}. Bind it first.`
      return fire(dev, a.action)
    }
  }))

    reg(defineTool({
    name: 'home_mode',
    description: 'list | set | apply modes (Sleep/Comfort/Away/Romantic or custom).',
    parameters: { action: { type: 'string', required: true }, mode: { type: 'string' }, device: { type: 'string' }, state: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(a) {
      const cfg = await load()
      const modes = cfg.modes || (cfg.modes = {})
      if (a.action === 'list') {
        const all = { ...DEFAULT_MODES, ...modes }
        return Object.entries(all).map(([n, l]) => `${icon(n)} ${n}: ` + (l.length ? l.map(x => x.device).join(', ') : '(empty)')).join('\n')
      }
      if (a.action === 'set') {
        if (!a.mode || !a.device) return '⚠️ need mode + device'
        const l = modes[a.mode] || (modes[a.mode] = [])
        l.push({ device: a.device, state: a.state || 'on' })
        await save(cfg)
        return `✅ ${a.device} added to "${a.mode}"`
      }
      if (a.action === 'apply') {
        const l = { ...DEFAULT_MODES, ...modes }[a.mode]
        if (!l || !l.length) return `⚠️ Mode "${a.mode}" empty.`
        const rs = []
        for (const s of l) {
          const dev = cfg.devices.find(d => d.name === s.device)
          rs.push(dev ? '  ' + await fire(dev, s.state === 'off' ? 'off' : 'on') : `  ⚠️ missing ${s.device}`)
        }
        return `🎛️ Mode "${a.mode}" executed:\n` + rs.join('\n')
      }
      return '⚠️ unknown action'
    }
  }))
}
