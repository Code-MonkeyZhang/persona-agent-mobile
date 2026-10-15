/**
 * @file src/env.ts
 * @description 裸 RN 环境下补齐 Expo 模块假设存在的构建期常量。
 *   babel-preset-expo 会在编译期把 process.env.EXPO_OS 内联为平台字符串，
 *   本项目不走 Expo 构建链，expo 系列库读到 undefined 会告警并自行降级。
 *   依赖 index.js 把本模块排在一切业务模块之前引入，
 *   import 的求值顺序保证常量在任何 expo 模块加载前就位。
 */
import { Platform } from 'react-native';

process.env.EXPO_OS = process.env.EXPO_OS ?? Platform.OS;
