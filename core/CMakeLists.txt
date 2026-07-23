cmake_minimum_required(VERSION 3.14)
project(syncer VERSION 0.1.0 LANGUAGES C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

# Add include directories
include_directories(include)

# Define the library
add_library(syncer SHARED
    src/syncer.c
    src/yyjson.c
)

# Export options
target_include_directories(syncer PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)
