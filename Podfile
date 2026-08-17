require_relative '../node_modules/react-native/scripts/react_native_pods'
require_relative '../node_modules/@react-native-community/cli-platform-ios/native_modules'

platform :ios, '14.0'
prepare_react_native_project!

target 'EasyComMobile' do
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath],
    :hermes_enabled => true,
    :fabric_enabled => false,
  )

  pod 'react-native-webrtc', :path => '../node_modules/react-native-webrtc'
  pod 'RNInCallManager', :path => '../node_modules/react-native-incall-manager'

  post_install do |installer|
    react_native_post_install(installer)
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'
      end
    end
  end
end
