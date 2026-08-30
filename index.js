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

const CONFIG_PATH = join(homedir(), '.dsh', 'jarvis-config.json')

const DEFAULT_MODES = { 'Sleep': [], 'Comfort': [], 'Away': [], 'Romantic': [] }
const MODE_ICONS = { 'Sleep': '🌙', 'Comfort': '🛋️', 'Away': '🏯', 'Romantic': '💕' }
const modeIcon = (n) => MODE_ICONS[n] || '⚙️'

async function loadConfig() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) }
  catch (e) { return { devices: [], modes: {}, error: e.message } }
}

async function saveConfig(cfg) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
}

async function universalControl(dev, action) {
  const url = dev.urls?.[action]
  if (!url) return `⚠️ No URL for action: ${action}`
  try {
    const r = await fetch(url, { method: dev.method || 'GET', signal: AbortSignal.timeout(5000) })
    return `${r.ok ? '✅' : '⚠️'} [HTTP] ${dev.name} ${action} -> ${r.status}`
  } catch (e) { return `⚠️ [HTTP] Cannot reach ${dev.name}: ${e.message}` }
}

async function ssdpDiscover(t = 4000) {
  return new Promise((res) => {
    const s = dgram.createSocket('udp4')
    const found = new Map()
    const done = () => { try { s.close() } catch {} res([...found.values()]) }
    const timer = setTimeout(done, t)
    s.on('error', () => { clearTimeout(timer); done() })
    s.on('message', (m, rinfo) => { try {
      const txt = m.toString()
      const st = (txt.match(/ST:\s*(.+)/i) || [])[1] || 'unknown'
      const srv = (txt.match(/SERVER:\s*(.+)/i) || [])[1] || ''
      if (!found.has(rinfo.address)) found.set(rinfo.address, { ip: rinfo.address, type: st.split(':').pop().trim(), server: srv.trim() })
    } catch {} })
    s.bind(0, () => { try {
      s.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: ssdp:all\r\n\r\n'), 1900, '239.255.255.250')
    } catch {} })
  })
}

const GREE_KEY = 'a3K8Bx%2r8Y7#3h%'
const ecb = (mode, key, data) => {
  const c = mode === 'enc' ? crypto.createCipheriv('aes-128-ecb', Buffer.from(key), null) : crypto.createDecipheriv('aes-128-ecb', Buffer.from(key), null)
  return Buffer.concat([c.update(data), c.final()])
}
async function greeScan(t = 2500) {
  return new Promise((res) => {
    const s = dgram.createSocket('udp4'); const found = []
    const timer = setTimeout(() => { try { s.close() } catch {} res(found) }, t)
    s.on('error', () => { clearTimeout(timer); try { s.close() } catch {} res(found) })
    s.on('message', (m) => { try {
      const j = JSON.parse(m.toString())
      if (j.t === 'pack' && j.pack) { const d = JSON.parse(ecb('dec', GREE_KEY, Buffer.from(j.pack, 'base64')).toString()); found.push({ ip: d.ip }) }
    } catch {} })
    s.bind(0, () => { try { s.setBroadcast(true); s.send(Buffer.from(JSON.stringify({ t: 'scan' })), 7000, '255.255.255.255') } catch {} })
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
  if (!settings || !settings.length) return `⚠️ Mode "${name}" is empty. Use home_mode set first.`
  const rs = []
  for (const s of settings) {
    const dev = cfg.devices.find(d => d.name === s.device)
    if (!dev) { rs.push(`  ⚠️ Device not found: ${s.device}`); continue }
    rs.push('  ' + await universalControl(dev, s.state))
  }
  return `🎛️ Mode "${name}" executed:\n${rs.join('\n')}`
}

export function apply(ctx) {
  console.error('[JARVIS] Tools Registering...')
  const reg = (tool) => {
    const tries = [() => ctx.tools.register(tool), () => ctx.registerTool(tool), () => ctx.get('tools').register(tool)]
    for (const f of tries) { try { return f() } catch (e) {} }
  }

  reg(defineTool({
    name: 'home_discover',
    description: 'Multi-protocol LAN radar: SSDP/UPnP (TVs, speakers) + Gree (AC). Lists discovered WiFi devices.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const [ssdp, gree] = await Promise.all([ssdpDiscover(), greeScan()])
      let md = '📡 JARVIS LAN Radar Report\n\n### UPnP/SSDP devices\n'
      if (!ssdp.length) md += '(none responded)\n'
      else md += '| IP | Type | Server |\n|---|---|---|\n' + ssdp.map(d => `| ${d.ip} | ${d.type} | ${d.server} |\n`).join('')
      md += '\n### Gree AC units\n'
      if (!gree.length) md += '(none responded)\n'
      else md += gree.map(g => `-
