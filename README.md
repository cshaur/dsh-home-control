# dsh-home-control 🏠

**Software-only unified smart home hub for DeepSeek Harness.**
No extra hardware. Control your existing branded appliances (TCL / Hisense / Gree...).

## 🌐 Routes
| Route | Driver | Deps |
|---|---|---|
| Bemfa bridge | `bemfa` | none |
| MiHome | `mija` | optional `micloud` |
| Gree LAN | `gree` | none |
| Home Assistant | `hass` | none |
| Wake-on-LAN | `wol` | none |

## 🎛️ Mode Engine
Built-in modes: 睡眠 / 舒适 / 空城计 / 浪漫 + unlimited custom modes.
Each mode lists per-device custom settings (temp, brightness...).

## 🚀 Install
```sh
npx @deepseek-ai/dsh plugin --profile web add github:cshaur/dsh-home-control