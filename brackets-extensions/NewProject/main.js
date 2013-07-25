/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, brackets, window, $, Mustache, navigator */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var ProjectManager              = brackets.getModule("project/ProjectManager"),
        PreferencesManager          = brackets.getModule("preferences/PreferencesManager"),
        Commands                    = brackets.getModule("command/Commands"),
        CommandManager              = brackets.getModule("command/CommandManager"),
        ExtensionUtils              = brackets.getModule("utils/ExtensionUtils"),
        AppInit                     = brackets.getModule("utils/AppInit"),
        Strings                     = brackets.getModule("strings"),
        SidebarView                 = brackets.getModule("project/SidebarView"),
        Menus                       = brackets.getModule("command/Menus"),
        PopUpManager                = brackets.getModule("widgets/PopUpManager"),
        FileUtils                   = brackets.getModule("file/FileUtils"),
        Dialogs                     = brackets.getModule("widgets/Dialogs"),
        NativeFileSystem            = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        NewProjectDialogTemplate    = require("text!htmlContent/New-Project-Dialog.html");
    

    /** @const {string} New Project command ID */
    var FILE_NEW_PROJECT            = "file.newProject";
        
    var prefs = PreferencesManager.getPreferenceStorage(module);

    function convertUnixPathToWindowsPath(path) {
        if (brackets.platform === "win") {
            path = path.replace(new RegExp(/\//g), "\\");
        }
        return path;
    }
    
    function cannonicalizeDirectoryName(path) {
        if (path && path.length) {
            var lastChar = path[path.length - 1];
            if (brackets.platform === "win") {
                if (lastChar !== "\\") {
                    path += "\\";
                }
            } else {
                if (lastChar !== "/") {
                    path += "/";
                }
            }
        }
        return path;
    }
    
    function getFilenameFromPath(path) {
        var searchChar = "/";
        if (brackets.platform === "win") {
            searchChar = "\\";
        }
        
        return path.substr(path.lastIndexOf(searchChar) + 1);
    }
        
    
    function isLegacyWindowsVersion() {
        return (navigator.userAgent.indexOf("Winodws NT 5.") !== -1);
    }
    
    function getUserHomeDirectory() {
        var folder = brackets.app.getApplicationSupportDirectory();
        if (brackets.platform === "win") {
            folder = convertUnixPathToWindowsPath(folder);
            return folder.split("\\").slice(0, 3).join("\\");
        } else {
            return "/" + folder.split("/").slice(0, 2).join("/");
        }
    }

    function getTemplateFilesFolder() {
        return convertUnixPathToWindowsPath(brackets.app.getApplicationSupportDirectory() + "/extensions/user/newproject/templateFiles");
    }
    
    function getUserDocumentsFolder() {
        var home = getUserHomeDirectory(),
            documents;
        
        if (brackets.platform === "win") {
            if (isLegacyWindowsVersion()) {
                documents = home + "\\My Documents";
            } else {
                documents = home + "\\Documents";
            }
        } else {
            documents = home + "/Documents";
        }
        
        return documents;
    }

    function showProjectErrorMessage(err, folder, isDirectory) {
        if (err === brackets.fs.NO_ERROR) {
            // unable to write to folder because it isn't a directory
            alert("unable to write to " + folder + " because it isn't a directory");
        } else {
            // some other error
            alert("some other error (" + err + ") " + "Writing or something to " + folder);
        }
    }
    

    function copyFile(destinationFolder, inFile) {
        var promise = new $.Deferred(),
            outFile = cannonicalizeDirectoryName(convertUnixPathToWindowsPath(destinationFolder)) + getFilenameFromPath(convertUnixPathToWindowsPath(inFile));
        brackets.fs.stat(outFile, function (err, stats) {
            if (err === brackets.fs.ERR_NOT_FOUND) {
                brackets.fs.readFile(convertUnixPathToWindowsPath(inFile), "utf8", function (err, data) {
                    brackets.fs.writeFile(outFile, data, "utf8", function (err) {
                        promise.resolve(err);
                    });
                });
            } else {
                promise.reject(err);
            }
        });
        return promise;
    }
    
    function copyTemplateFiles(destination) {
        var i,
            completeCount = 0,
            errorCount = 0,
            promise = new $.Deferred(),
            templatesFilesFolder = getTemplateFilesFolder();
        brackets.fs.readdir(convertUnixPathToWindowsPath(templatesFilesFolder), function (err, fileList) {
            if (err === brackets.fs.NO_ERROR) {
                var failHandler = function () {
                    ++errorCount;
                };
                var alwaysHandler = function () {
                    if (++completeCount === fileList.length) {
                        promise.resolve(errorCount);
                    }
                };
                for (i = 0; i < fileList.length; i++) {
                    copyFile(destination, cannonicalizeDirectoryName(templatesFilesFolder) + fileList[i])
                        .fail(failHandler)
                        .always(alwaysHandler);

                }
            } else {
                promise.reject(err);
            }
        });
        
        return promise;
    }

    function createProjectFolder(projectFolder) {
        var promise = new $.Deferred();
        brackets.fs.makedir(convertUnixPathToWindowsPath(projectFolder), 777, function (err) {
            if (err === brackets.fs.NO_ERROR) {
                copyTemplateFiles(projectFolder)
                    .done(function () {
                        promise.resolve();
                    })
                    .fail(function () {
                        promise.reject();
                    });
                
            } else {
                showProjectErrorMessage(err, projectFolder);
                promise.reject(err);
            }
        });
        return promise;
    }
    
    
    function createNewProject(documentsFolder, projectFolder) {
        var promise = new $.Deferred();
        brackets.fs.stat(documentsFolder, function (err, stats) {
            if (err === brackets.fs.NO_ERROR && stats.isDirectory()) {
                createProjectFolder(projectFolder)
                    .done(function () {
                        promise.resolve();
                    })
                    .fail(function () {
                        promise.reject();
                    });
            } else {
                showProjectErrorMessage(err, projectFolder, stats.isDirectory());
                promise.reject();
            }
        });
        return promise;
    }
    
    function openIndexFile(destination) {
        var indexFilename = cannonicalizeDirectoryName(convertUnixPathToWindowsPath(destination)) + "index.html";
        brackets.fs.stat(indexFilename, function (err, stats) {
            if (err === brackets.fs.NO_ERROR && stats.isFile()) {
                CommandManager.execute(Commands.FILE_ADD_TO_WORKING_SET, { fullPath: FileUtils.convertWindowsPathToUnixPath(indexFilename) });
            }
        });

    }
    
    function handleNewProject(commandData) {
        var $dlg,
            $changeProjectDirectoryBtn,
            $projectDirectoryInput,
            $projectNameInput,
            newProjectOrdinal = prefs.getValue("newProjectOrdiinal") || 1,
            defaultProjectName = "Untitled-" +  newProjectOrdinal.toString(),
            prefsNewProjectFolder = prefs.getValue("newProjectsFolder"),
            newProjectFolder = getUserDocumentsFolder();
        
        if (prefsNewProjectFolder) {
            prefsNewProjectFolder = convertUnixPathToWindowsPath(prefsNewProjectFolder);
        }
        
        var context = {
            Strings: Strings,
            PROJECT_DIRECTORY: prefsNewProjectFolder || newProjectFolder,
            NEXT_NEW_PROJECT_NAME: defaultProjectName
        };
        
        var dialog = Dialogs.showModalDialogUsingTemplate(Mustache.render(NewProjectDialogTemplate, context));
        
        dialog.done(function (buttonId) {
            if (buttonId === "ok") {
                var projectFolder = FileUtils.convertWindowsPathToUnixPath($projectDirectoryInput.val()),
                    projectName = $projectNameInput.val(),
                    destination = projectFolder + "/" + ((projectName.length > 0) ? projectName : defaultProjectName);

                createNewProject(projectFolder, destination).done(function () {
                    ProjectManager.openProject(destination).done(function () {
                        openIndexFile(destination);
                    });
                    prefs.setValue("newProjectOrdinal", ++newProjectOrdinal);
                });
            }
        });
        
        $dlg = dialog.getElement();
        $changeProjectDirectoryBtn = $("#change-directory", $dlg);
        $projectDirectoryInput = $("#project-directory", $dlg);
        $projectNameInput = $("#project-name", $dlg);
        
        $changeProjectDirectoryBtn.click(function (e) {
            NativeFileSystem.showOpenDialog(false, true, Strings.CHOOSE_FOLDER, newProjectFolder, null,
                function (files) {
                    if (files.length > 0 && files[0].length > 0) {
                        newProjectFolder = convertUnixPathToWindowsPath(files[0]);
                        $projectDirectoryInput.val(newProjectFolder);
                        prefs.setValue("newProjectsFolder", newProjectFolder);
                    }
                },
                function (error) {
                });
            
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
    CommandManager.register("New Project...", FILE_NEW_PROJECT, handleNewProject);
    var menu = Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
    menu.addMenuItem(FILE_NEW_PROJECT, undefined, Menus.AFTER, Commands.FILE_NEW_UNTITLED);

});
