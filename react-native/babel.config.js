module.exports = {
  // nativewind/babel includes react-native-reanimated/plugin as its last plugin,
  // so we don't need to list it separately in plugins.
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
};
