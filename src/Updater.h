#pragma once

namespace s3
{
/** Result of comparing this copy with the latest published Windows build. */
enum class UpdateState
{
    current,  /**< Online, and this copy already matches the published build. */
    staged,   /**< A newer build is downloaded and a helper will swap it in after this process exits. */
    offline,  /**< The public project could not be reached. */
    failed,   /**< The check ran, but the build could not be downloaded or replaced. */
    skipped,  /**< This copy is a local build, not a published one, so it does not replace itself. */
    busy      /**< A check is already running. */
};

/** Looks up the latest published build. When it is newer, downloads it and arms a relaunch.
    A published copy updates itself wherever it was unzipped or installed. A build made in this
    tree does not. Safe to call from a background thread.
*/
UpdateState stagePublishedUpdate();
}
