cmake_minimum_required(VERSION 3.22)

project(Studio4000 VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if (MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    add_compile_options(/MP /bigobj /utf-8)
endif()

set(STUDIO_EXTERNAL ${CMAKE_CURRENT_SOURCE_DIR}/external)
set(JUCE_WEBVIEW2_PACKAGE_LOCATION ${STUDIO_EXTERNAL}/webview2 CACHE PATH "" FORCE)

add_subdirectory(${STUDIO_EXTERNAL}/tracktion_engine/modules/juce ${CMAKE_BINARY_DIR}/juce)
add_subdirectory(${STUDIO_EXTERNAL}/tracktion_engine/modules ${CMAKE_BINARY_DIR}/tracktion)

juce_add_gui_app(Studio4000
    PRODUCT_NAME "Studio 4000"
    COMPANY_NAME "Studio4000"
    BUNDLE_ID "org.studio4000.app"
    ICON_BIG ${CMAKE_CURRENT_SOURCE_DIR}/resources/icon.png
    MICROPHONE_PERMISSION_ENABLED TRUE
    NEEDS_WEBVIEW2 TRUE
    NEEDS_CURL FALSE
    NEEDS_WEB_BROWSER TRUE)

juce_generate_juce_header(Studio4000)

target_sources(Studio4000 PRIVATE
    src/Main.cpp
    src/AppEngine.cpp
    src/RpcRegistry.cpp
    src/ProjectState.cpp
    src/MainWindow.cpp
    src/AgentServer.cpp
    src/SessionRelay.cpp
    src/LoudnessMeterPlugin.cpp
    src/LimiterPlugin.cpp
    src/SmartMix.cpp
    src/StudioFx.cpp
    src/Instruments.cpp
    src/LiveMidi.cpp
    src/api/ApiProject.cpp
    src/api/ApiTransport.cpp
    src/api/ApiTracks.cpp
    src/api/ApiClips.cpp
    src/api/ApiPlugins.cpp
    src/api/ApiAutomation.cpp
    src/api/ApiExport.cpp
    src/api/ApiSmart.cpp
    src/api/ApiAi.cpp
    src/api/ApiDevices.cpp
    src/SelfTest.cpp
    src/Updater.cpp)

target_include_directories(Studio4000 PRIVATE src)

# The ASIO SDK is Steinberg's and is not in the public repo. Builds without it still play through WASAPI.
set(STUDIO_ASIO 0)
if (EXISTS "${STUDIO_EXTERNAL}/asiosdk/common/iasiodrv.h")
    set(STUDIO_ASIO 1)
    target_include_directories(Studio4000 PRIVATE ${STUDIO_EXTERNAL}/asiosdk/common)
    message(STATUS "ASIO: on")
else()
    message(STATUS "ASIO: off (no SDK at ${STUDIO_EXTERNAL}/asiosdk)")
endif()

# Hosting VST2 (.dll) plug-ins needs Steinberg's VST2 SDK headers, which can't be redistributed. Put the SDK folder that
# contains pluginterfaces/vst2.x/aeffect.h at external/vst2sdk (or pass -DSTUDIO_VST2_SDK=...) and VST2 hosting turns on.
set(STUDIO_VST2_SDK "${STUDIO_EXTERNAL}/vst2sdk" CACHE PATH "Folder containing pluginterfaces/vst2.x/aeffect.h")
if (EXISTS "${STUDIO_VST2_SDK}/pluginterfaces/vst2.x/aeffect.h")
    set(STUDIO_HOST_VST2 1)
    target_include_directories(Studio4000 PRIVATE ${STUDIO_VST2_SDK})
    message(STATUS "VST2 hosting: on (${STUDIO_VST2_SDK})")
else()
    set(STUDIO_HOST_VST2 0)
    message(STATUS "VST2 hosting: off (no VST2 SDK at ${STUDIO_VST2_SDK})")
endif()

target_compile_definitions(Studio4000 PRIVATE
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:Studio4000,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:Studio4000,JUCE_VERSION>"
    JUCE_ASIO=${STUDIO_ASIO}
    JUCE_WASAPI=1
    JUCE_DIRECTSOUND=0
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_VST=${STUDIO_HOST_VST2}
    STUDIO4000_PLUGIN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/vsts"
    JUCE_PLUGINHOST_AU=0
    JUCE_PLUGINHOST_LADSPA=0
    JUCE_USE_FLAC=1
    JUCE_USE_OGGVORBIS=1
    JUCE_USE_MP3AUDIOFORMAT=1
    JUCE_USE_WINDOWS_MEDIA_FORMAT=1
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_STRICT_REFCOUNTEDPOINTER=1
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_REPORT_APP_USAGE=0
    TRACKTION_ENABLE_TIMESTRETCH_SOUNDTOUCH=1
    TRACKTION_AIR_WINDOWS=1
    _USE_MATH_DEFINES)

target_link_libraries(Studio4000 PRIVATE
    tracktion::tracktion_core
    tracktion::tracktion_engine
    tracktion::tracktion_graph
    juce::juce_audio_devices
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_extra
    juce::juce_dsp
    juce::juce_recommended_config_flags)

set(STUDIO_UI_DIST ${CMAKE_CURRENT_SOURCE_DIR}/ui/dist)
# Runs on every build (not only when the exe relinks) and replaces the folders, so UI-only changes ship and old bundles don't pile up.
add_custom_target(StudioCompanions ALL
    COMMAND ${CMAKE_COMMAND} -E rm -rf $<TARGET_FILE_DIR:Studio4000>/ui
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${STUDIO_UI_DIST} $<TARGET_FILE_DIR:Studio4000>/ui
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_CURRENT_SOURCE_DIR}/mcp $<TARGET_FILE_DIR:Studio4000>/mcp
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_CURRENT_SOURCE_DIR}/server $<TARGET_FILE_DIR:Studio4000>/server
    DEPENDS Studio4000
    COMMENT "Copying UI bundle, MCP server and session server next to the executable")
