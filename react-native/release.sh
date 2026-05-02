#!/bin/bash

version="$1"
version_code="$2"
echo ${version}
echo ${version_code}
regex="[0-9]\+\.[0-9]\+\.[0-9]\+"
version_code_regex="[0-9]\+"

# modify react native project version
sed -i "s/\"version\": \"${regex}\"/\"version\": \"${version}\"/g" package.json

# modify android version
sed -i "s/versionCode ${version_code_regex}/versionCode ${version_code}/g" android/app/build.gradle
sed -i "s/versionName \"${regex}\"/versionName \"${version}\"/g" android/app/build.gradle

# modify iOS version
sed -i "s/MARKETING_VERSION = ${regex};/MARKETING_VERSION = ${version};/g" ios/Persona.xcodeproj/project.pbxproj
sed -i "s/CURRENT_PROJECT_VERSION = ${version_code_regex};/CURRENT_PROJECT_VERSION = ${version_code};/g" ios/Persona.xcodeproj/project.pbxproj

# modify README download link
sed -i "s/download\/${regex}\/Persona.apk/download\/${version}\/Persona.apk/g" ../README.md
