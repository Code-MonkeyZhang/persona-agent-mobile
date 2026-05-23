<p align="right">
<a href="README.md">简体中文</a> | English
</p>

<div align="center">

<img src="assets/logo-rounded.png" width="150" height="150" alt="Persona Agent Mobile" />

# Persona Agent Mobile

**Your own AI Agent on mobile**

The mobile client for Persona. Connect to your locally running [Persona desktop app](https://github.com/Code-MonkeyZhang/persona-agent) to chat with your AI Agents anytime, anywhere. Features character portraits, voice synthesis, and more.

[![License: MIT-0](https://img.shields.io/badge/License-MIT--0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20Android-informational)
[![Release](https://img.shields.io/github/v/release/Code-MonkeyZhang/persona-agent-mobile?include_prereleases)](https://github.com/Code-MonkeyZhang/persona-agent-mobile/releases)

</div>

> This project is built on top of [SwiftChat](https://github.com/aws-samples/swift-chat)

## Demo

<table>
  <tr>
    <td align="center"><b>AI Portrait</b></td>
    <td align="center"><b>Conversation</b></td>
    <td align="center"><b>Agent Details</b></td>
  </tr>
  <tr>
    <td><img src="assets/mobile-agent.gif" width="250" /></td>
    <td><img src="assets/normal-conversation.gif" width="250" /></td>
    <td><img src="assets/agent-detail.gif" width="250" /></td>
  </tr>
</table>

## Key Features

- **Streaming Chat** — Receive Agent responses in real-time via WebSocket, with Markdown rendering, code highlighting, and Mermaid diagram support
- **Multi-Agent Management** — Browse all Agents, view details (model config, system prompt, MCP services, Skills), and switch with one tap
- **Companion Mode** — Full-screen character portrait and background display. The Agent switches expressions based on conversation context, with voice synthesis for spoken responses
- **Remote Access** — Connect to your local Persona Agent Server from anywhere via Cloudflare Tunnel
- **Dark / Light Theme** — Switch between dark and light themes

## Installation

| Platform | Method                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| Android  | Download the APK from [Releases](https://github.com/Code-MonkeyZhang/persona-agent-mobile/releases) |
| iOS      | Build from source using Xcode                                                                   |

## Connecting to the Server

Persona Mobile connects to your local Persona desktop app via Cloudflare Tunnel.

1. Make sure [Persona Agent Server](https://github.com/Code-MonkeyZhang/persona-agent) is running on your computer (it starts automatically with the desktop app)
2. Create a Cloudflare Tunnel in the desktop app settings to get a public access URL

   <img src="assets/create_tunnel.gif" width="250" />

3. Open Persona on your phone → Settings → Paste the Tunnel URL

   <img src="assets/paste-to-phone.gif" width="250" />

4. Once connected, you're ready to chat!

## Contact

This project is developed and maintained by [Zhang Yufeng](https://github.com/Code-MonkeyZhang). Contributions and suggestions via issues and PRs are welcome. For questions, ideas, or collaboration, feel free to reach out at [yufengzhang483@gmail.com](mailto:yufengzhang483@gmail.com).

## Acknowledgements

- [React Native](https://reactnative.dev/) — Cross-platform mobile framework
- [Zustand](https://zustand.docs.pmnd.rs/) — State management
- [react-native-gifted-chat](https://github.com/FaridSafi/react-native-gifted-chat) — Chat UI component
- [react-native-track-player](https://react-native-track-player.js.org/) — TTS audio playback
