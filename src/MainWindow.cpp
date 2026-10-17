#include "MainWindow.h"
#include "Updater.h"

namespace s3
{
namespace
{
    const juce::Colour background (0xff07080c);

    const char* mimeFor (const String& ext)
    {
        static const std::map<String, const char*> types {
            { "html", "text/html" }, { "js", "text/javascript" }, { "mjs", "text/javascript" }, { "css", "text/css" },
            { "json", "application/json" }, { "svg", "image/svg+xml" }, { "png", "image/png" }, { "jpg", "image/jpeg" },
            { "woff", "font/woff" }, { "woff2", "font/woff2" }, { "ttf", "font/ttf" }, { "wasm", "application/wasm" },
            { "ico", "image/x-icon" }, { "wav", "audio/wav" }, { "txt", "text/plain" }, { "map", "application/json" }
        };

        auto it = types.find (ext.toLowerCase());
        return it != types.end() ? it->second : "application/octet-stream";
    }

    juce::File uiRoot()
    {
        return juce::File::getSpecialLocation (juce::File::currentExecutableFile).getParentDirectory().getChildFile ("ui");
    }

    std::optional<juce::WebBrowserComponent::Resource> loadResource (const String& url)
    {
        auto path = url.upToFirstOccurrenceOf ("?", false, false).upToFirstOccurrenceOf ("#", false, false);

        if (path.isEmpty() || path == "/")
            path = "/index.html";

        auto root = uiRoot();
        auto file = root.getChildFile (path.substring (1));

        if (! file.isAChildOf (root) || ! file.existsAsFile())
        {
            // Single-page app: unknown routes fall back to index.html.
            if (path.contains ("."))
                return std::nullopt;

            file = root.getChildFile ("index.html");
        }

        juce::MemoryBlock block;

        if (! file.loadFileAsData (block))
            return std::nullopt;

        juce::WebBrowserComponent::Resource r;
        r.data.resize (block.getSize());
        std::memcpy (r.data.data(), block.getData(), block.getSize());
        r.mimeType = mimeFor (file.getFileExtension().substring (1));
        return r;
    }

    String devServerUrl()
    {
        return juce::SystemStats::getEnvironmentVariable ("S4000_DEV_URL", {});
    }

    const char* fallbackPage = R"HTML(<!doctype html><html><body style="background:#07080c;color:#cfd6ff;font-family:Segoe UI,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center">
<h1 style="font-weight:300;letter-spacing:.3em">STUDIO 4000</h1><p>The interface files are missing next to the executable (folder <code>ui</code>).</p>
<p>Rebuild with <code>build.ps1</code> to bundle them.</p></div></body></html>)HTML";
}

//==============================================================================
class MainWindow::Content : public juce::Component
{
public:
    Content (AppEngine& a, AgentServer& ag) : app (a), agent (ag)
    {
        using Options = juce::WebBrowserComponent::Options;

        const auto dev = devServerUrl();
        std::optional<String> allowedOrigin;

        if (dev.isNotEmpty())
            allowedOrigin = juce::URL (dev).getOrigin();

        auto options = Options{}
            .withBackend (Options::Backend::webview2)
            .withWinWebView2Options (Options::WinWebView2{}
                                         .withUserDataFolder (appDataDir().getChildFile ("webview"))
                                         .withBackgroundColour (background)
                                         .withStatusBarDisabled()
                                         .withBuiltInErrorPageDisabled())
            .withKeepPageLoadedWhenBrowserIsHidden()
            .withNativeIntegrationEnabled()
            .withResourceProvider ([] (const String& url) { return loadResource (url); }, allowedOrigin)
            .withInitialisationData ("platform", "windows")
            .withNativeFunction ("rpc", [this] (const juce::Array<var>& args, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                const auto origin = args.size() > 2 ? args[2].toString() : String ("ui");
                done (app.rpc.call (args[0].toString(), args.size() > 1 ? args[1] : var(), origin == "collab" || origin == "assistant" ? origin : String ("ui")));
            })
            .withNativeFunction ("pickFile", [this] (const juce::Array<var>& args, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                pickFile (args.size() > 0 ? args[0] : var(), std::move (done));
            })
            .withNativeFunction ("http", [] (const juce::Array<var>& args, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                httpRequest (args.size() > 0 ? args[0] : var(), std::move (done));
            })
            .withNativeFunction ("secret", [this] (const juce::Array<var>& args, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                // UI-only storage for API keys: not reachable through the rpc registry or the agent port.
                const auto key = "secret" + args[0].toString().retainCharacters ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

                if (args.size() > 1)
                {
                    app.settings().setValue (key, args[1].toString());
                    app.settings().saveIfNeeded();
                }

                done (app.settings().getValue (key));
            })
            .withNativeFunction ("agentInfo", [this] (const juce::Array<var>&, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                done (Obj().set ("port", agent.getPort()).set ("token", agent.getToken())
                           .set ("configFile", appDataDir().getChildFile ("agent.json").getFullPathName())
                           .set ("mcpServer", juce::File::getSpecialLocation (juce::File::currentExecutableFile)
                                                  .getParentDirectory().getChildFile ("mcp").getChildFile ("index.mjs").getFullPathName()));
            })
            .withNativeFunction ("window", [this] (const juce::Array<var>& args, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                if (auto* w = findParentComponentOfClass<juce::DocumentWindow>())
                {
                    auto action = args[0].toString();

                    if (action == "fullscreen")     w->setFullScreen (! w->isFullScreen());
                    else if (action == "minimise")  w->setMinimised (true);
                    else if (action == "title")     w->setName (args[1].toString());
                    else if (action == "quit")      juce::JUCEApplication::getInstance()->systemRequestedQuit();
                }

                done (true);
            })
            .withNativeFunction ("checkUpdate", [] (const juce::Array<var>&, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                juce::Thread::launch ([done = std::move (done)]
                {
                    const auto state = stagePublishedUpdate();
                    const char* name = "failed";

                    switch (state)
                    {
                        case UpdateState::current: name = "current"; break;
                        case UpdateState::staged:  name = "staged"; break;
                        case UpdateState::offline: name = "offline"; break;
                        case UpdateState::failed:  name = "failed"; break;
                        case UpdateState::skipped: name = "skipped"; break;
                        case UpdateState::busy:    name = "busy"; break;
                    }

                    juce::MessageManager::callAsync ([done, name, state]
                    {
                        done (Obj().set ("state", name));

                        if (state == UpdateState::staged)
                            if (auto* app = juce::JUCEApplication::getInstance())
                                app->systemRequestedQuit();
                    });
                });
            })
            .withNativeFunction ("openUrl", [] (const juce::Array<var>& args, juce::WebBrowserComponent::NativeFunctionCompletion done)
            {
                juce::URL url (args[0].toString());

                if (url.getScheme() == "https" || url.getScheme() == "http" || url.getScheme() == "mailto")
                    url.launchInDefaultBrowser();

                done (true);
            });

        // Session servers on a LAN are plain ws://, and remote voice must play without a click.
        _putenv_s ("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--allow-running-insecure-content --autoplay-policy=no-user-gesture-required");

        browser = std::make_unique<juce::WebBrowserComponent> (options);
        addAndMakeVisible (*browser);

        app.sendEvent = [this] (const String& type, const var& payload)
        {
            if (browser != nullptr)
                browser->emitEventIfBrowserIsVisible ("s3", Obj().set ("type", type).set ("payload", payload));
        };

        if (dev.isNotEmpty())
            browser->goToURL (dev);
        else if (uiRoot().getChildFile ("index.html").existsAsFile())
            browser->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
        else
            browser->goToURL ("data:text/html;charset=utf-8," + juce::URL::addEscapeChars (fallbackPage, false));
    }

    ~Content() override
    {
        app.sendEvent = nullptr;
    }

    void resized() override
    {
        browser->setBounds (getLocalBounds());
    }

    void paint (juce::Graphics& g) override
    {
        g.fillAll (background);
    }

private:
    void pickFile (const var& p, juce::WebBrowserComponent::NativeFunctionCompletion done)
    {
        const auto mode = str (p, "mode", "open");
        const auto title = str (p, "title", "Choose a file");
        const auto filters = str (p, "filters", "*");
        auto start = has (p, "file") ? juce::File (str (p, "file"))
                   : has (p, "dir")  ? juce::File (str (p, "dir"))
                                     : (app.currentEdit() != nullptr ? app.getProjectDir() : defaultProjectsDir());

        chooser = std::make_unique<juce::FileChooser> (title, start, filters, true);

        int flags = juce::FileBrowserComponent::canSelectFiles;

        if (mode == "save")         flags = juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                                          | juce::FileBrowserComponent::warnAboutOverwriting;
        else if (mode == "folder")  flags = juce::FileBrowserComponent::canSelectDirectories;
        else                        flags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles
                                          | (flag (p, "multiple") ? juce::FileBrowserComponent::canSelectMultipleItems : 0);

        chooser->launchAsync (flags, [done = std::move (done)] (const juce::FileChooser& fc)
        {
            juce::Array<var> files;

            for (auto& f : fc.getResults())
                files.add (f.getFullPathName());

            done (files);
        });
    }

    static void httpRequest (const var& p, juce::WebBrowserComponent::NativeFunctionCompletion done)
    {
        const juce::URL base (str (p, "url"));
        const auto scheme = base.getScheme();
        const auto host = base.getDomain();

        if (! (scheme == "https" || (scheme == "http" && (host == "localhost" || host == "127.0.0.1"))))
        {
            done (Obj().set ("status", 0).set ("error", "Only https, or http to localhost, is allowed"));
            return;
        }

        juce::Thread::launch ([p, base, done = std::move (done)]
        {
            String headers;

            if (auto* h = p["headers"].getDynamicObject())
                for (auto& kv : h->getProperties())
                    headers << kv.name.toString() << ": " << kv.value.toString() << "\r\n";

            auto url = base;
            const auto method = str (p, "method", "GET");

            if (has (p, "body"))
                url = url.withPOSTData (str (p, "body"));

            int status = 0;
            juce::StringPairArray responseHeaders;

            auto options = juce::URL::InputStreamOptions (has (p, "body") ? juce::URL::ParameterHandling::inPostData
                                                                          : juce::URL::ParameterHandling::inAddress)
                               .withExtraHeaders (headers)
                               .withConnectionTimeoutMs (integer (p, "timeoutMs", 120000))
                               .withHttpRequestCmd (method)
                               .withStatusCode (&status)
                               .withResponseHeaders (&responseHeaders)
                               .withNumRedirectsToFollow (3);

            String body;

            if (auto stream = url.createInputStream (options))
                body = stream->readEntireStreamAsString();

            juce::MessageManager::callAsync ([done, status, body]
            {
                done (Obj().set ("status", status).set ("body", body));
            });
        });
    }

    AppEngine& app;
    AgentServer& agent;
    std::unique_ptr<juce::WebBrowserComponent> browser;
    std::unique_ptr<juce::FileChooser> chooser;
};

//==============================================================================
MainWindow::MainWindow (AppEngine& a, AgentServer& ag)
    : DocumentWindow ("Studio 4000", background, DocumentWindow::allButtons), app (a), agent (ag)
{
    lookAndFeel.setColourScheme ({ 0xff07080c, 0xff0c0e14, 0xff07080c, 0xff1a1f2e, 0xffcfd6ff,
                                   0xff7c5cff, 0xffffffff, 0xff141826, 0xffcfd6ff });
    setLookAndFeel (&lookAndFeel);
    setUsingNativeTitleBar (false);
    setTitleBarHeight (28);
    setTitleBarTextCentred (true);

    content = std::make_unique<Content> (app, agent);
    setContentNonOwned (content.get(), false);
    setResizable (true, false);
    setResizeLimits (960, 600, 10000, 10000);

    const auto area = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()->userArea;
    setBounds (area.reduced (juce::jmax (0, (area.getWidth() - 1680) / 2), juce::jmax (0, (area.getHeight() - 1000) / 2)));

    if (auto saved = app.settings().getValue ("windowState"); saved.isNotEmpty())
        restoreWindowStateFromString (saved);

    setVisible (true);
}

MainWindow::~MainWindow()
{
    app.settings().setValue ("windowState", getWindowStateAsString());
    app.settings().saveIfNeeded();
    clearContentComponent();
    content.reset();
    setLookAndFeel (nullptr);
}

void MainWindow::closeButtonPressed()
{
    juce::JUCEApplication::getInstance()->systemRequestedQuit();
}
}
