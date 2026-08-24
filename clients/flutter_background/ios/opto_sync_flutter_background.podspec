Pod::Spec.new do |s|
  s.name             = 'opto_sync_flutter_background'
  s.version          = '0.2.1'
  s.summary          = 'BGTaskScheduler background draining and connectivity signals for opto-sync.'
  s.description      = <<-DESC
Runs the opto-sync mutation-queue drain in a headless FlutterEngine from
BGAppRefreshTask / BGProcessingTask and exposes UI-agnostic NWPathMonitor
connectivity events. Swift implementation with Objective-C bridges.
                       DESC
  s.homepage         = 'https://github.com/opto-sync'
  s.license          = { :type => 'MIT' }
  s.author           = { 'opto-sync' => 'noreply@optosync.dev' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.frameworks       = 'Network'
  s.platform         = :ios, '13.0'
  s.swift_version    = '5.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
