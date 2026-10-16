#pragma once

#include "AppEngine.h"
#include "AgentServer.h"

namespace s3
{
class MainWindow : public juce::DocumentWindow
{
public:
    MainWindow (AppEngine&, AgentServer&);
    ~MainWindow() override;

    void closeButtonPressed() override;

private:
    class Content;

    AppEngine& app;
    AgentServer& agent;
    juce::LookAndFeel_V4 lookAndFeel;
    std::unique_ptr<Content> content;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MainWindow)
};
}
