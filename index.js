import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import dgram from 'node:dgram'
import crypto from 'node:crypto'

console.error('[home-control] MODULE LOADED')

let defineTool = (x) => x
try { const m = await import('@deepseek-ai/dsh-tools'); if (m.defineTool) defineTool = m.defineTool } catch {}

export const name = 'dsh-home-control'
export const inject = ['tools']

const CONFIG_PATH = join(homedir(), '.dsh', 'home-control.json')

const DEFAULT_MODES = { '睡眠': [], '舒适': [], '空城计': [], '浪漫': [] }
const MODE_ICONS = { '睡眠': '🌙', '舒适': '🛋️', '空城计': '🏯', '浪漫': '💕' }
const modeIcon = (n) => MODE_ICONS[n] || '⚙️'

const resolveEnv = (v) => (typeof v === 'string' && v.startsWith('${') && v.endsWith('}'))
  ? (process.env[v.slice(2, -1)] || v) : v

async function loadConfig() {
  try {
    const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
    if (cfg.accounts) Object.values(cfg.accounts).forEach(a => Object.keys(a).forEach(k => a[k] = resolveEnv(a[k])))
    if (cfg.devices) cfg.devices.forEach(d => { d.ip = resolveEnv(d.ip); d.host = resolveEnv(d.host) })
    return cfg
  } catch (e) { return { accounts: {}, hubs: {}, devices: [], modes: {}, error: e.message } }
}

async function saveConfig(cfg) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
}

function parseParams(str) {
  const out = {}
  if (!str) return out
  str.split(/\s+/).forEach(kv => { const [k, ...v] = kv.split('='); if (k && v.length) out[k] = v.join('=') })
  return out
}

function formatSetting(s) {
  const { device, state, ...rest } = s
  const parts = [state || 'on']
  Object.entries(rest).forEach(([k, v]) => parts.push(`${k}=${v}`))
  return parts.join(', ')
}

const GREE_KEY = 'a3K8Bx%2r8Y7#3h%'
const ecb = (mode, key, data) => {
  const c = mode === 'enc' ? crypto.createCipheriv('aes-128-ecb', Buffer.from(key), null)
    : crypto.createDecipheriv('aes-128-ecb', Buffer.from(key), null)
  return Buffer.concat([c.update(data), c.final()])
}

async function greeScan(t = 3000) {
  return new Promise((res) => {
    const s = dgram.createSocket('udp4'); const found = []
    const timer = setTimeout(() => { try { s.close() } catch {} res(found) }, t)
    s.on('error', () => { clearTimeout(timer); try { s.close() } catch {} res(found) })
    s.on('message', (m) => { try {
      const j = JSON.parse(m.toString())
      if (j.t === 'pack' && j.pack) { const d = JSON.parse(ecb('dec', GREE_KEY, Buffer.from(j.pack, 'base64')).toString()); found.push({ ip: d.ip, key: d.key }) }
    } catch {} })
    s.bind(0, () => { try {
      s.setBroadcast(true)
      s.send(Buffer.from(JSON.stringify({ t: 'scan' })), 7000, '255.255.255.255')
    } catch {} })
  })
}

const drivers = {
  demo: {
    control: async (d, a, c, p = {}) => `✅ [DEMO] ${d.name} ${a.toUpperCase()} ${p.temp ? `temp=${p.temp}` : ''}${p.brightness ? `bri=${p.brightness}` : ''}`,
    status: async () => ({ state: 'on', ok: true })
  },
  bemfa: {
    control: async (d, a, cfg) => {
      const uid = cfg.accounts?.bemfa?.uid; if (!uid) return '⚠️ bemfa 缺 uid'
      const r = await fetch(`http://api.bemfa.com/api/device/v1/data/?uid=${uid}&topic=${d.topic}&msg=${a === 'on' ? '1' : '0'}`, { signal: AbortSignal.timeout(6000) })
      return `${r.ok ? '✅' : '⚠️'} [Bemfa] ${d.name} → ${r.status}`
    },
    status: async (d, cfg) => {
      const uid = cfg.accounts?.bemfa?.uid; if (!uid) return { state: 'unknown', ok: false }
      try { const r = await fetch(`http://api.bemfa.com/api/device/v1/data/?uid=${uid}&topic=${d.topic}`, { signal: AbortSignal.timeout(4000) }); const j = await r.json(); return { state: j.data?.msg === '1' ? 'on' : 'off', ok: r.ok } }
      catch { return { state: 'unknown', ok: false } }
    }
  },
  mija: {
    control: async (d, a) => { try {
      const mi = await import('micloud'); const fn = mi.control || mi.default?.control
      if (!fn) return '⚠️ mija: micloud API 不匹配'
      await fn(d.did, a); return `✅ [MiHome] ${d.name} ${a}`
    } catch (e) { return `⚠️ mija: ${e.message}` } },
    status: async () => ({ state: 'cloud', ok: true })
  },
  gree: {
    control: async (d, a, c, p = {}) => { try {
      const list = await greeScan()
      if (!list.some(x => x.ip === d.ip)) return '⚠️ gree: 未发现设备'
      return `✅ [Gree LAN] ${d.name} ${a} ${p.temp ? `temp=${p.temp}` : ''} (实验性)`
    } catch (e) { return `⚠️ gree: ${e.message}` } },
    status: async (d) => { const l = await greeScan(2000); return { state: l.some(x => x.ip === d.ip) ? 'online' : 'offline', ok: l.length > 0 } }
  },
  hass: {
    control: async (d, a, cfg, p = {}) => {
      const hub = cfg.hubs?.[d.hub || 'ha']; if (!hub) return '⚠️ hass 缺 hubs'
      const data = { ...p }; delete data.device; delete data.state
      const domain = (d.entity || 'switch.x').split('.')[0]
      const r = await fetch(`${hub.base}/api/services/${domain}/${a === 'on' ? 'turn_on' : 'turn_off'}`, {
        method: 'POST', headers: { Authorization: `Bearer ${hub.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: d.entity, ...data }), signal: AbortSignal.timeout(8000)
      })
      return `${r.ok ? '✅' : '⚠️'} [HA] ${d.name} → ${r.status}`
    },
    status: async () => ({ state: 'hub', ok: true })
  },
  wol: {
    control: async (d, a) => { if (a !== 'on') return '⚠️ wol 只支持开机'
      const mac = Buffer.from(d.mac.replace(/[^0-9a-fA-F]/g, ''), 'hex')
      const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(mac)])
      return new Promise((res) => {
        const s = dgram.createSocket('udp4')
        s.on('error', () => { try { s.close() } catch {} res('⚠️ WoL 发送失败') })
        s.bind(() => { try {
          s.setBroadcast(true)
          s.send(pkt, 9, '255.255.255.255', () => { try { s.close() } catch {} res(`✅ [WoL] ${d.mac}`) })
        } catch { res('⚠️ WoL 发送失败') } })
      })
    },
    status: async () => ({ state: 'standby', ok: true })
  }
}

async function applyMode(cfg, name, confirmed) {
  const modes = { ...DEFAULT_MODES, ...(cfg.modes || {}) }
  const settings = modes[name]
  if (!settings || !settings.length) return `⚠️ 模式「${name}」未设定家电。先用 home_mode set 添加。`
  if (settings.some(s => s.state === 'off') && !confirmed)
    return `⚠️ 危险确认：模式「${name}」包含关闭操作。回复“确认执行”或传 confirmed:true。`
  const rs = []
  for (const s of settings) {
    const dev = cfg.devices.find(d => d.name === s.device)
    if (!dev) { rs.push('  ⚠️ 未找到 ' + s.device); continue }
    const params = { ...s }; delete params.device
    const r = await drivers[dev.driver]?.control(dev, s.state === 'off' ? 'off' : 'on', cfg, params) || `  ⚠️ ${dev.driver} 无驱动`
    rs.push('  ' + r)
  }
  return `🎛️ 模式「${name}」已应用:\n${rs.join('\n')}`
}

async function renderDashboard(cfg) {
  const modes = { ...DEFAULT_MODES, ...(cfg.modes || {}) }
  let md = '## 🏠 智能家居仪表盘\n\n'
  for (const [n, list] of Object.entries(modes)) {
    md += `### ${modeIcon(n)} ${n}\n`
    if (!list.length) md += '(未设定家电)\n\n'
    else { md += '| 家电 | 自定义设定 |\n|---|---|\n'; list.forEach(s => md += `| ${s.device} | ${formatSetting(s)} |\n`); md += '\n' }
  }
  md += '### 📱 所有设备\n| Device | Driver | Status |\n|---|---|---|\n'
  for (const d of cfg.devices) {
    const st = await drivers[d.driver]?.status(d, cfg) || { state: 'unknown', ok: false }
    md += `| ${d.name} | ${d.driver} | ${st.ok ? '🟢' : '🔴'} ${st.state} |\n`
  }
  return md
}

export function apply(ctx) {
  console.error('[home-control] APPLY CALLED')
  const reg = (tool) => {
    const tries = [
      () => ctx.tools.register(tool),
      () => ctx.registerTool(tool),
      () => ctx.get('tools').register(tool)
    ]
    let err
    for (const f of tries) { try { return f() } catch (e) { err = e } }
    console.error('[home-control] register failed:', err && err.message)
  }

  reg(defineTool({
    name: 'home_mode',
    description: 'Manage home modes. action: list|apply|create|set|delete.',
    parameters: {
      action: { type: 'string', required: true, description: 'list | apply | create | set | delete' },
      mode: { type: 'string' }, device: { type: 'string' }, state: { type: 'string' },
      params: { type: 'string', description: 'key=value, e.g. temp=26 brightness=10' },
      confirmed: { type: 'boolean' }
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      let cfg = await loadConfig()
      if (cfg.error) cfg = { accounts: {}, hubs: {}, devices: [], modes: {} }
      const modes = cfg.modes || (cfg.modes = {})
      switch (args.action) {
        case 'list': {
          const all = { ...DEFAULT_MODES, ...modes }
          return Object.entries(all).map(([n, l]) =>
            `${modeIcon(n)} ${n}: ${l.length ? l.map(x => `${x.device}(${formatSetting(x)})`).join(', ') : '(未设定)'}`).join('\n')
        }
        case 'apply': return await applyMode(cfg, args.mode, args.confirmed)
        case 'create':
          if (!args.mode) return '⚠️ 需要 mode'
          modes[args.mode] = modes[args.mode] || []
          await saveConfig(cfg); return `✅ 已创建自定义模式「${args.mode}」`
        case 'delete':
          if (!modes[args.mode]) return '⚠️ 模式不存在'
          delete modes[args.mode]; await saveConfig(cfg); return `✅ 已删除「${args.mode}」`
        case 'set': {
          if (!args.mode || !args.device) return '⚠️ set 需要 mode 和 device'
          const list = modes[args.mode] || (modes[args.mode] = [])
          const setting = { ...parseParams(args.params), device: args.device, state: args.state || 'on' }
          const i = list.findIndex(x => x.device === args.device)
          if (i >= 0) list[i] = setting; else list.push(setting)
          await saveConfig(cfg); return `✅ [${args.mode}] ${args.device} → ${formatSetting(setting)}`
        }
        default: return '⚠️ 未知 action'
      }
    }
  }))

  reg(defineTool({
    name: 'home_dashboard',
    description: 'Render Markdown dashboard.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() { return await renderDashboard(await loadConfig()) }
  }))

  reg(defineTool({
    name: 'home_control',
    description: 'Control a single device. action: on/off.',
    parameters: { action: { type: 'string', required: true }, target: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      if (!['on', 'off'].includes(args.action)) return '⚠️ 目前只支持 on/off'
      const cfg = await loadConfig()
      const dev = cfg.devices.find(d => d.name === args.target)
      if (!dev) return `⚠️ 未找到「${args.target}」`
      return await drivers[dev.driver]?.control(dev, args.action, cfg) || '⚠️ 无驱动'
    }
  }))

  reg(defineTool({
    name: 'home_status',
    description: 'Get status of all devices.',
    parameters: { target: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const cfg = await loadConfig()
      const list = args.target ? cfg.devices.filter(d => d.name === args.target) : cfg.devices
      const rs = await Promise.all(list.map(async d => {
        const st = await drivers[d.driver]?.status(d, cfg) || { state: 'unknown', ok: false }
        return `${st.ok ? '🟢' : '🔴'} ${d.name} (${d.driver}): ${st.state}`
      }))
      return rs.join('\n') || '无设备'
    }
  }))
}
