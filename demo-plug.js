import { createServer } from 'node:http'
import dgram from 'node:dgram'
import os from 'node:os'

let state = 'off'

const http = createServer((req, res) => {
  const u = req.url || '/'
  if (u.startsWith('/on')) { state = 'on'; console.log('🟢 Demo Plug -> ON') }
  if (u.startsWith('/off')) { state = 'off'; console.log('🔴 Demo Plug -> OFF') }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ device: 'Demo Plug', state }))
})
http.listen(8888, () => console.log('🔌 Demo Plug HTTP online: http://127.0.0.1:8888 (try /on /off)'))

function getIp() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list)
      if (i.family === 'IPv4' && !i.internal) return i.address
  return '127.0.0.1'
}

const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
s.on('error', (e) => console.log('⚠️ SSDP responder disabled (port 1900 busy):', e.message))
s.on('message', (m, r) => {
  if (!m.toString().includes('M-SEARCH')) return
  const resp = [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=1800',
    'ST: JARVIS-DEMO-PLUG',
    'SERVER: JARVIS-DemoPlug/2.0',
    'LOCATION: http://' + getIp() + ':8888/',
    'USN: uuid:jarvis-demo-plug::' + getIp(),
    '', ''
  ].join('\r\n')
  s.send(Buffer.from(resp), r.port, r.address, () => console.log('📡 Answered radar ping from', r.address))
})
s.bind(1900, () => { try { s.addMembership('239.255.255.250'); console.log('📡 SSDP responder online - JARVIS radar can discover me!') } catch (e) { console.log('⚠️ multicast join failed:', e.message) } })
