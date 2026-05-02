<div align="center">

<img src="assets/logo-rounded.png" width="150" height="150" alt="Persona Agent Mobile" />

# Persona Agent Mobile

**Persona 的移动端客户端**

连接你本地运行的 [Persona Agent Server](https://github.com/Code-MonkeyZhang/persona-agent)，在手机上随时随地与 AI Agent 对话。

[![License: MIT-0](https://img.shields.io/badge/License-MIT--0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20Android-informational)
[![Release](https://img.shields.io/github/v/release/Code-MonkeyZhang/persona-agent-mobile?include_prereleases)](https://github.com/Code-MonkeyZhang/persona-agent-mobile/releases)

</div>

## 功能演示

<table>
  <tr>
    <td align="center"><b>移动端演示</b></td>
    <td align="center"><b>普通对话</b></td>
    <td align="center"><b>Agent 详情</b></td>
  </tr>
  <tr>
    <td><img src="assets/mobile-agent.gif" width="250" /></td>
    <td><img src="assets/normal-conversation.gif" width="250" /></td>
    <td><img src="assets/agent-detail.gif" width="250" /></td>
  </tr>
</table>

## 核心功能

- **流式对话** — WebSocket 实时接收 Agent 回复，支持 Markdown 渲染、代码高亮、Mermaid 图表
- **多 Agent 管理** — 浏览所有 Agent，查看详情（模型配置、系统提示词、MCP 服务、Skills），一键切换
- **伴侣模式** — 全屏展示角色立绘与背景图，Agent 根据对话自动切换表情，配合语音合成朗读回复
- **远程连接** — 通过 Cloudflare Tunnel 从外网连接你本地运行的 Persona Agent Server
- **暗色 / 亮色主题** — 支持暗色和亮色两种主题切换

## 下载安装

| 平台    | 方式                                                                 |
| ------- | -------------------------------------------------------------------- |
| Android | 前往 [Releases](https://github.com/Code-MonkeyZhang/persona-agent-mobile/releases) 下载 APK 安装 |
| iOS     | 通过 Xcode 源码编译安装                                              |

## 连接 Server

1. 确保电脑上运行着 [Persona Agent Server](https://github.com/Code-MonkeyZhang/persona-agent)（桌面端启动即可自动运行）
2. 在手机上打开 Persona → 设置 → 填入 Server 地址（如 `http://192.168.1.100:3847`）
3. 连接成功后即可开始对话

Server 开启 Cloudflare Tunnel 后也可通过公网地址连接。

## Contact

本项目由 [Zhang Yufeng](https://github.com/Code-MonkeyZhang) 个人开发维护。如有问题、想法或合作意向，欢迎联系 [yufengzhang483@gmail.com](mailto:yufengzhang483@gmail.com)。

## 致谢

- [SwiftChat](https://github.com/aws-samples/swift-chat) — 本项目基于 SwiftChat 二次开发
- [React Native](https://reactnative.dev/) — 跨平台移动端框架
- [Zustand](https://zustand.docs.pmnd.rs/) — 状态管理
- [react-native-gifted-chat](https://github.com/FaridSafi/react-native-gifted-chat) — 聊天 UI 组件
- [react-native-track-player](https://react-native-track-player.js.org/) — TTS 音频播放
