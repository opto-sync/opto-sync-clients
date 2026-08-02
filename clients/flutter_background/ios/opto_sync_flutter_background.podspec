Pod::Spec.new do |s|
  s.name             = 'opto_sync_flutter_background'
  s.version          = '0.1.1'
  s.summary          = 'BGTaskScheduler background draining for opto-sync.'
  s.description      = <<-DESC
Runs the opto-sync mutation-queue drain in a headless FlutterEngine from
BGAppRefreshTask / BGProcessingTask. Swift implementation with an
Objective-C registration shim for ObjC host apps.
                       DESC
  s.homepage         = 'https://github.com/opto-sync'
  s.license          = { :type => 'MIT' }
  s.author           = { 'opto-sync' => 'noreply@optosync.dev' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform         = :ios, '13.0'
  s.swift_version    = '5.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
