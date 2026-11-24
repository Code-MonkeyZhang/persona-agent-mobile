/**
 * 静态图片资源的模块声明,import 引用本地 png 与 webp 时补齐类型。
 * 两种格式经 Metro 解析后都是资源编号。
 */
declare module '*.png' {
  const value: number;
  export default value;
}

declare module '*.webp' {
  const value: number;
  export default value;
}
