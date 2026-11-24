module.exports = {
  preset: 'react-native',
  // 静态导入的图片映射到空桩，资源索引的键集测试才跑得起来
  moduleNameMapper: {
    '\\.(png|webp)$': '<rootDir>/__mocks__/fileMock.js',
  },
};
