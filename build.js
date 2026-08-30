const fs = require('fs');
const path = require('path');

const pkg = {
  name: "dsh-home-control", version: "2.0.0", type: "module", main: "index.js",
  description: "Industrial-grade Smart Home OS for DSH with Approval Gate.",
  exports: { ".": "./index.js", "./cordis.patch.yml": "./cordis.patch.yml" },
  keywords: ["dsh-plugin", "smart-home", "jarvis", "approval-gate"],
  author: "cshaur", license: "MIT",
  dsh: { bundle: { patch: "./cordis.patch.yml" } }
};

const patch = `- insert:\n    - id: home-control\n      name: dsh-home-control\n`;

const core = `import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

console.error('[JARVIS v2.0] Industrial Core Online.');
let defineTool = (x) => x;
try { const m = await import('@deepseek-ai/dsh-tools'); if (m.defineTool) defineTool = m.defineTool; } catch {}

export const name = 'dsh-home-control';
export const inject = ['tools'];
const CONFIG_PATH = join(homedir(), '.dsh', 'home-control.json');

async function load() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')); } 
  catch { return { devices: [], modes: {} }; }
}
async function save(cfg) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

async function fire(dev, action) {
  if (dev.driver === 'demo') return \`✅ [DEMO] \${dev.name} \${action.toUpperCase()}\`;
  const url = dev.urls?.[action];
  if (!url) return \`⚠️ \${dev.name}: no URL for \${action}\`;
  try {
    const r = await fetch(url, { method: dev.method || 'GET', signal: AbortSignal.timeout(5000) });
    return \`\${r.ok ? '✅' : '⚠️'} \${dev.name} \${action} -> \${r.status}\`;
  } catch (e) { return \`⚠️ \${dev.name}: \${e.message}\`; }
}

export function apply(ctx) {
  console.error('[JARVIS v2.0] Registering Tools with Approval Gate...');
  const reg = (t) => { try { ctx.tools.register(t); } catch {} };

  reg(defineTool({
    name: 'home_dashboard', description: 'Read: Render smart home dashboard.',
    parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const cfg = await load();
      let md = '## 🏠 JARVIS Dashboard\\n\\n';
      for (const [n, l] of Object.entries(cfg.modes || {})) {
        md += \`### ⚙️ \${n}\\n\`;
        if (l.length) md += '| Device | Settings |\\n|---|---|\\n' + l.map(s => \`| \${s.device} | \${s.state} |\\n\`).join('') + '\\n';
      }
      md += '### 📱 Devices\\n| Name | Driver | Status |\\n|---|---|---|\\n';
      for (const d of cfg.devices) md += \`| \${d.name} | \${d.driver || 'http'} | 🟢 |\\n\`;
      return md;
    }
  }));

  reg(defineTool({
    name: 'home_control', description: 'Write: Control device. REQUIRES confirm=true for safety gate.',
    parameters: { action: { type: 'string', required: true }, target: { type: 'string', required: true }, confirm: { type: 'boolean' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(a) {
      if (!a.confirm) return \`⚠️ SAFETY GATE: You are about to turn \${a.action} "\${a.target}". This changes physical state. Reply with confirm=true to proceed.\`;
      const cfg = await load();
      const dev = cfg.devices.find(d => d.name === a.target);
      if (!dev) return \`⚠️ Not found: \${a.target}\`;
      return fire(dev, a.action);
    }
  }));

  reg(defineTool({
    name: 'home_mode', description: 'Write: Apply mode. REQUIRES confirm=true for safety gate.',
    parameters: { action: { type: 'string', required: true }, mode: { type: 'string' }, confirm: { type: 'boolean' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(a) {
      if (a.action === 'apply') {
        if (!a.confirm) return \`⚠️ SAFETY GATE: Apply mode "\${a.mode}"? Reply with confirm=true.\`;
        const cfg = await load();
        const l = (cfg.modes || {})[a.mode];
        if (!l) return '⚠️ Mode not found.';
        const rs = [];
        for (const s of l) { const dev = cfg.devices.find(d => d.name === s.device); if(dev) rs.push('  ' + await fire(dev, s.state)); }
        return \`🎛️ Mode "\${a.mode}" executed:\\n\` + rs.join('\\n');
      }
      return '⚠️ Use action=apply';
    }
  }));
}`;

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
fs.writeFileSync('cordis.patch.yml', patch, 'utf8');
fs.writeFileSync('index.js', core, 'utf8');
console.log('🏭 Industrial Build Complete. Files generated with strict UTF-8.');