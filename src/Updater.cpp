#include "Updater.h"

#include <JuceHeader.h>
#include <windows.h>
#include <atomic>

namespace s3
{
namespace
{
constexpr const char* releaseApi = "https://api.github.com/repos/Cruz4/Studio-4000--2-/releases/latest";
constexpr const char* downloadPrefix = "https://github.com/Cruz4/Studio-4000--2-/releases/download/";

std::atomic<bool> busy { false };

bool isSha (const juce::String& value)
{
    return value.length() >= 7 && value.length() <= 40 && value.containsOnly ("0123456789abcdef");
}

juce::String localCommit()
{
    const auto text = juce::File::getSpecialLocation (juce::File::currentApplicationFile)
                          .getSiblingFile ("version.json").loadFileAsString();
    return juce::JSON::parse (text)["commit"].toString().trim().toLowerCase();
}

juce::String readBody (const juce::URL& url, int timeoutMs)
{
    const auto options = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                             .withConnectionTimeoutMs (timeoutMs)
                             .withNumRedirectsToFollow (5)
                             .withExtraHeaders ("User-Agent: Studio4000\r\nAccept: application/vnd.github+json\r\n");

    if (auto stream = url.createInputStream (options))
        return stream->readEntireStreamAsString();

    return {};
}

bool downloadTo (const juce::URL& url, const juce::File& dest)
{
    const auto options = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                             .withConnectionTimeoutMs (20000)
                             .withNumRedirectsToFollow (5)
                             .withExtraHeaders ("User-Agent: Studio4000\r\nAccept: application/octet-stream\r\n");

    auto stream = url.createInputStream (options);

    if (stream == nullptr)
        return false;

    dest.deleteFile();
    juce::FileOutputStream out (dest);

    if (! out.openedOk())
        return false;

    out.writeFromInputStream (*stream, -1);
    out.flush();
    return dest.getSize() > 1000000;
}

bool launchHelper (const juce::File& script)
{
    // The command text has to outlive toWideCharPointer(). A temporary String here
    // was already freed, so the helper process started with a blank command and the
    // app quit without ever coming back.
    const juce::String command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""
                                 + script.getFullPathName() + "\"";
    std::wstring writable (command.toWideCharPointer());

    STARTUPINFOW si {};
    si.cb = sizeof (si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi {};

    if (! CreateProcessW (nullptr, writable.data(), nullptr, nullptr, FALSE,
                          CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
                          nullptr, nullptr, &si, &pi))
        return false;

    CloseHandle (pi.hThread);
    CloseHandle (pi.hProcess);
    return true;
}
}

UpdateState finish (UpdateState state)
{
    busy = false;
    return state;
}

UpdateState stagePublishedUpdate()
{
    if (busy.exchange (true))
        return UpdateState::busy;

    const auto exe = juce::File::getSpecialLocation (juce::File::currentApplicationFile);
    const auto home = exe.getParentDirectory();

    // Published copies carry version.json. The build tree does not get replaced out from under a compile.
    if (! home.getChildFile ("version.json").existsAsFile()
        || home.getFullPathName().containsIgnoreCase ("Studio4000_artefacts"))
        return finish (UpdateState::skipped);

    if (! home.hasWriteAccess())
        return finish (UpdateState::failed);

    const auto body = readBody (juce::URL (releaseApi), 8000);

    if (body.isEmpty())
        return finish (UpdateState::offline);

    const auto release = juce::JSON::parse (body);
    auto remote = release["tag_name"].toString().trim().toLowerCase();

    if (remote.startsWith ("b-"))
        remote = remote.fromFirstOccurrenceOf ("b-", false, false);

    // Only a build tagged with its own commit is a real update. Anything else (including the
    // original 0.1.0 tag) is left alone so an older file can never replace a newer one.
    if (! isSha (remote) || remote == localCommit())
        return finish (UpdateState::current);

    const auto updateRoot = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("Studio4000Update");

    // A copy that failed once must not quit the app on every later click.
    if (updateRoot.getChildFile ("skip-" + remote).existsAsFile())
        return finish (UpdateState::current);

    juce::String assetUrl;
    if (auto* assets = release["assets"].getArray())
    {
        for (const auto& asset : *assets)
        {
            const auto name = asset["name"].toString();
            const auto url = asset["browser_download_url"].toString();

            if (name.endsWithIgnoreCase ("win64.zip") && url.startsWith (downloadPrefix))
                assetUrl = url;
        }
    }

    if (assetUrl.isEmpty())
        return finish (UpdateState::failed);

    auto work = updateRoot.getChildFile (remote);
    work.deleteRecursively();
    work.createDirectory();
    const auto zipFile = work.getChildFile ("update.zip");

    if (! downloadTo (juce::URL (assetUrl), zipFile))
        return finish (UpdateState::failed);

    juce::ZipFile zip (zipFile);
    juce::String packagedCommit;
    bool hasExe = false;

    for (int i = 0; i < zip.getNumEntries(); ++i)
    {
        const auto name = zip.getEntry (i)->filename.replaceCharacter ('\\', '/');

        if (name.endsWithIgnoreCase ("Studio 4000.exe"))
            hasExe = true;

        if (name.endsWithIgnoreCase ("version.json"))
        {
            std::unique_ptr<juce::InputStream> entry (zip.createStreamForEntry (i));

            if (entry != nullptr)
                packagedCommit = juce::JSON::parse (entry->readEntireStreamAsString())["commit"].toString().trim().toLowerCase();
        }
    }

    if (! hasExe || packagedCommit != remote)
    {
        work.deleteRecursively();
        return finish (UpdateState::failed);
    }

    const auto unpack = work.getChildFile ("unpack");
    zip.uncompressTo (unpack);
    const auto found = unpack.findChildFiles (juce::File::findFiles, true, "Studio 4000.exe");

    if (found.isEmpty())
    {
        work.deleteRecursively();
        return finish (UpdateState::failed);
    }

    const auto source = found.getFirst().getParentDirectory();
    const auto script = work.getChildFile ("apply.ps1");
    const auto quote = [] (const juce::String& path) { return path.replace ("'", "''"); };
    const auto pid = (int) GetCurrentProcessId();

    const auto skip = updateRoot.getChildFile ("skip-" + remote);
    script.replaceWithText (
        "$ErrorActionPreference = 'Continue'\r\n"
        "Wait-Process -Id " + juce::String (pid) + " -ErrorAction SilentlyContinue\r\n"
        "Start-Sleep -Milliseconds 800\r\n"
        "& robocopy '" + quote (source.getFullPathName()) + "' '" + quote (home.getFullPathName()) + "' /E /R:3 /W:1 /NFL /NDL /NJH /NJS\r\n"
        "$code = $LASTEXITCODE\r\n"
        "if ($code -ge 8) { New-Item -ItemType File -Force -Path '" + quote (skip.getFullPathName()) + "' | Out-Null }\r\n"
        "Start-Process -FilePath '" + quote (home.getChildFile ("Studio 4000.exe").getFullPathName()) + "'\r\n"
        "if ($code -ge 8) { exit $code }\r\n");

    if (! launchHelper (script))
        return finish (UpdateState::failed);

    // Leave busy set so a second check cannot arm another helper before this process exits.
    return UpdateState::staged;
}
}
