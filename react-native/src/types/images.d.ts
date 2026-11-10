/**
 * 静态图片资源的模块声明,require 引用本地 png 时补齐类型。
 */
declare module '*.png' {
  const value: number;
  export default value;
}
