require 'bundler/setup'

desc "Build the Jekyll site"
task :build do
  puts "Building Jekyll site..."
  sh "bundle exec jekyll build"
  puts "Site built in _site/"
end

desc "Run local development server on localhost:4000"
task :serve do
  puts "Starting Jekyll development server on http://localhost:4000"
  sh "bundle exec jekyll serve --watch"
end

desc "Clean build artifacts"
task :clean do
  puts "Cleaning build artifacts..."
  sh "rm -rf _site .jekyll-cache .jekyll-metadata"
  puts "Clean complete"
end

desc "Rebuild site (clean + build)"
task :rebuild => [:clean, :build]

task default: :serve
