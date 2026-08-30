\# dsh-home-control 🏠



\*\*纯软件统一智能家居中枢（DeepSeek Harness 插件）。\*\*

不买硬件，直接控制你家现有的 TCL / 海信 / 格力等联网家电。



\## 🌐 三大路线

\- 巴法云 `bemfa`（通用桥接，免费）

\- 米家 `mija`（可选库 micloud）

\- 格力局域网 `gree`（实验性）

\- 兜底 `hass` / `wol`



\## 🎛️ 模式引擎

内置：睡眠 / 舒适 / 空城计 / 浪漫；支持无限自定义模式。

每个模式下列出所有家电的自定义设定（温度/亮度等）。



\## 🚀 安装

```sh

npx @deepseek-ai/dsh plugin --profile web add github:cshaur/dsh-home-control

