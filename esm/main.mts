import { spawn } from "child_process";
import type { WatchOptions } from "chokidar";
import chokidar from "chokidar";
import type { BrowserWindow } from "electron";
import { app } from "electron";
import fs from "fs";

const appPath = app.getAppPath();
const ignoredPaths = /node_modules|[/\\]\./;

/**
 * Creates a callback for hard resets.
 *
 * @param {string} executable path to electron executable
 * @param {string} hardResetMethod method to restart electron
 * @param {string[]} eArgv arguments passed to electron
 * @param {string[]} aArgv arguments passed to the application
 * @returns {function} handler to pass to chokidar
 */
const createHardResetHandler =
  (
    executable: ElectronReloadOptions["electron"],
    hardResetMethod: ElectronReloadOptions["hardResetMethod"],
    eArgv: ElectronReloadOptions["electronArgv"],
    aArgv: ElectronReloadOptions["appArgv"]
  ) =>
  () => {
    if (!executable) return;

    // Detaching child is useful when in Windows to let child
    // live after the parent is killed
    const args = (eArgv || []).concat([appPath]).concat(aArgv || []);
    const child = spawn(executable, args, {
      detached: true,
      stdio: "inherit",
    });
    child.unref();
    // Kamikaze!

    // In cases where an app overrides the default closing or quitting actions
    // firing an `app.quit()` may not actually quit the app. In these cases
    // you can use `app.exit()` to gracefully close the app.
    if (hardResetMethod === "exit") {
      app.exit();
    } else {
      app.quit();
    }
  };

interface ElectronReloadOptions extends WatchOptions {
  /**
   * Path to electron binary: this is used for hard resets, e.g.
   * in case of changes to the main file.
   */
  electron?: string;
  /**
   * Arguments passed to the electron binary (relevant for hard
   * resets).
   */
  electronArgv?: string[];
  /**
   * Arguments passed to the application (relevant for hard
   * resets).
   */
  appArgv?: string[];
  /**
   * Determines how to terminate electron in case of hard resets.
   * See 'https://www.electronjs.org/docs/api/app' for details.
   */
  hardResetMethod?: "exit" | "quit";
  /**
   * Enforces a hard reset for all changes (and not just the main
   * file).
   */
  forceHardReset?: boolean;
}

export default function electronReload(
  glob: string,
  mainFile: string,
  options: ElectronReloadOptions = {}
) {
  const browserWindows: BrowserWindow[] = [];
  const watcher = chokidar.watch(
    glob,
    Object.assign({ ignored: [ignoredPaths, mainFile] }, options)
  );

  // Callback function to be executed:
  // I) soft reset: reload browser windows
  const softResetHandler = () =>
    browserWindows.forEach((bw) => bw.webContents.reloadIgnoringCache());
  // II) hard reset: restart the whole electron process
  const executable = options.electron;
  const hardResetHandler = createHardResetHandler(
    executable,
    options.hardResetMethod,
    options.electronArgv,
    options.appArgv
  );

  // Add each created BrowserWindow to list of maintained items
  app.on("browser-window-created", (_, bw) => {
    browserWindows.push(bw);

    // Remove closed windows from list of maintained items
    bw.on("closed", function () {
      const i = browserWindows.indexOf(bw); // Must use current index
      browserWindows.splice(i, 1);
    });
  });

  // Enable default soft reset
  watcher.on("change", softResetHandler);

  // Preparing hard reset if electron executable is given in options
  // A hard reset is only done when the main file has changed
  if (executable) {
    if (!fs.existsSync(executable)) {
      throw new Error(
        "Provided electron executable cannot be found or is not executable!"
      );
    }

    const hardWatcher = chokidar.watch(
      mainFile,
      Object.assign({ ignored: [ignoredPaths] }, options)
    );

    if (options.forceHardReset === true) {
      // Watch every file for hard reset and not only the main file
      hardWatcher.add(glob);
      // Stop our default soft reset
      watcher.close();
    }

    hardWatcher.once("change", hardResetHandler);
  }
}
