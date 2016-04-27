angular.module('seashell-local-files', [])
  /**
   * Local file storage service, using localforage.js
   * Must call init before using!
   */
  .service('localfiles', ['$q', '$cookies',
    function($q, $cookies) {
      "use strict";
      var self = this;

      self.user = null;   // username
      self.store = null;  // localForage instance
      self.projects = []; // offline storage of all project trees
      self.offlineChangelog = []; // array of OfflineChange objects 
      self.offlineChangelogSet = {}; // properties determine membership in offlineChangelog


      /* Constructor for an OfflineChange
       * It stores information about a file that has changed offline
       *   but not online, so that it can be updated when the user goes 
       *   back online.
       */
      var OfflineChange = function(project, path) {
        var self = this;
        self.project = project;
        self.path = path;
      };

      // Getter for project name. Returns a string.
      OfflineChange.prototype.getProject = function() {
        var self = this;
        return self.project;
      };

      // Getter for path. Returns a string.
      OfflineChange.prototype.getPath = function() {
        var self = this;
        return self.path;
      };


      // Returns the offline changelog as a dictionary (object)
      //   of projects (keys) to paths (values), grouped by project. 
      // Eg. {"A1": ["foo/bar/baz.txt", "foo/bar/bar.txt"]} 
      self.getOfflineChangelog = function () {
        var self = this;
        var result = _.chain(self.offlineChangelog)
          .groupBy(function(oc) { return oc.getProject(); })
          .mapObject(function(paths, project) {
            return _.map(paths, function (oc) { 
              return oc.getPath(); 
            }); 
          });
        return result.value();
      };

      // Add a change to the offline changelog.
      // Does nothing if the change is already logged.
      self._addOfflineChange = function(project, path) {
        var self = this;
        var key = sprintf("%s/%s", project, path);
        if (!(key in self.offlineChangelogSet)) {
          self.offlineChangelogSet[key] = true;
          self.offlineChangelog.push(new OfflineChange(project, path));
          return $q.when(self.store.setItem("//offlineChangelog", self.offlineChangelog));
        } else {
          return $q.when();
        }
      };


      // Sync offline changes. The argument should be a function
      //   that accepts one parameter: the value of getOfflineChangelog()
      self.syncOfflineChanges = function(syncFunction) {
        return $q.when(syncFunction(self.getOfflineChangelog()))
          .then(function () {
            self.offlineChangelog = [];
            self.offlineChangelogSet = {};
            return $q.when(self.store.setItem("//offlineChangelog", self.offlineChangelog));
          });
      };

      // Must call this before using anything
      // Returns a deferred that resolves to true when initialization is complete.
      self.init = function() {
        var self = this;
        self.user = $cookies.getObject(SEASHELL_CREDS_COOKIE).user;

        // set up localforage to have a per-user store
        //   note that this doesn't actually secure anything:
        //   it only prevents name conflicts
        self.store = localforage.createInstance({
          name: self.user,
          version: 1.0
        });

        var getProjects = 
          self.store.getItem("//projects")
          .then(function(projs) {
            self.projects = projs || [];
            console.log("[localfiles] projects", self.projects);
          });

        var getOfflineChanges = 
          self.store.getItem("//offlineChangelog")
          .then(function(data) {
            self.offlineChangelog = [];
            self.offlineChangelogSet = {};
            for (var id in data) {
              var oc = data[id];
              var offlineChange = new OfflineChange(oc.project, oc.path);
              var key = sprintf("%s/%s", offlineChange.getProject(), offlineChange.getPath());
              self.offlineChangelog.push(offlineChange);
              self.offlineChangelogSet[key] = true;
            }
            console.log("offlineChangelog", self.offlineChangelog);
            console.log("offlineChangelogSet", self.offlineChangelogSet);
          });

        return $q.all([getProjects, getOfflineChanges])
          .then(function () { return true; });
      };

      /*
       * Returns the path to where this file is stored.
       */
      self._path = function(project, file) {
        return sprintf("%s/%s", project, file); 
      };

      /*
       * Save a file to local storage.
       * @param {string} name: project name
       * @param {string} file_name: filename
       * @param {string} file_content: The contents of the file
       * @param {string | false} checksum: MD5 checksum of the contents,
       *   or false for an offline-write
       */
      self.writeFile = function(name, file_name, file_content, checksum) {
        var offline_checksum = md5(file_content);
        var path = self._path(name, file_name);
        var def = $q.defer();

        // checksum is false when we're doing an offline write
        if (checksum === false) {
          // read and write back
          return $q.when(self.store.getItem(path)).then(
            function(contents) {
              contents = contents || {};
              contents.data = file_content;
              contents.offline_checksum = offline_checksum;
              self._addOfflineChange(name, file_name);
              console.log("[localfiles] Offline Write", contents);
              return self.store.setItem(path, contents);
            }
          );
        } else {
          var to_write = {
            data: file_content,
            online_checksum: checksum,
            offline_checksum: offline_checksum
          };
          console.log("[localfiles] Writing: ", to_write);
          return $q.when(self.store.setItem(path, to_write));
        }
      };

      self.readFile = function(name, file_name) {
        return $q.when(self.store.getItem(self._path(name, file_name))).then(
          function(contents) {
            console.log("[localfiles] Reading", contents);
            return contents;
          });
      };


      self.renameFile = function(project, old_name, new_name) {
        self.readFile(project, old_name)
          .then(
            function(contents) {
              self.writeFile(project, new_name, contents.data, contents.online_checksum);
            })
          .then(
            function() {
              self.deleteFile(project, old_name);
            });
      };

      self.deleteFile = function(name, file_name) {
        console.log("[localfiles] deleteFile");
        return $q.when(self.store.removeItem(self._path(name, file_name)));
      };

      self.getRunnerFile = function(name, question) {
        return self.store.getItem(self._path(name, question) + "//runnerFile")
          .then(function(contents) {
            console.log("[localfiles] getRunnerFile", contents);
            return contents;
          });
      };

      self.setRunnerFile = function(name, question, folder, file) {
        if (folder == "common" || folder == "tests")
          return $q.reject("Runner file must be in question directory.");
        console.log("[localfiles] setRunnerFile");
        return $q.when(self.store.setItem(self._path(name, question) + "//runnerFile", file));
      };

      // Flatten the project tree into a list of nodes
      // to be stored offline.
      // When this is read out again, project-service will
      // convert it back into a tree. The return value of this function
      // is the same format as what listProject returns.
      self._serializeProject = function(project) {
        // A project is an array [name, is_dir, timestamp (0), hash (false)] 
        var initial = [[project.name.join("/"), project.is_dir, 0, false]];
        return initial.concat(self._serializeChildren(project.children));
      };

      // Calls serializeProject on a list of children and folds the results
      // Need this because we need to exclude the root from the flattened list.
      self._serializeChildren = function(children) {
        return  _.foldl(children, function (rest, p) {
          return rest.concat(self._serializeProject(p));
        }, []); 
      };

      // Store an entire SeashellProject tree into the offline store
      self._dumpProject = function(project) {
        // manually (trivially) serialize the project,
        // stripping away things we don't need
        // NOTE: exclude the root!
        var serialized = self._serializeChildren(project.root.children); 
        return $q.when(self.store.setItem(sprintf("//projects/%s", project.name), serialized));
      };
      
      self.listProject = function(name) {
        // return the entire SeashellProject tree
        return $q.when(self.store.getItem(sprintf("//projects/%s", name)));
      };

      self.newDirectory = function(name, dir_path) {
        console.log("[localfiles] newDirectory", name, dir_path);
        // do nothing, since dumpProject will take care of this
      };

      self.newFile = function(name, file_name, contents,
        encoding, normalize) {
        console.log("[localfiles] newFile", name, file_name, contents);
        // TODO: decoding 
        // name: project name
        // file_name: relative path under project
        self.writeFile(name, file_name, contents, false);
      };


      // Overwrite the offline project list with a new list of projects 
      self.setProjects = function(projects) {
        self.projects = projects;
        return $q.when(self.store.setItem("//projects", self.projects));
      };

      self.newProject = function(name) {
        console.log("[localfiles] newProject", name);
        self.projects.push(name);
        return $q.when(self.store.setItem("//projects", self.projects));
      };

      self.getProjects = function() {
        console.log("[localfiles] getProjects", self.projects);
        return $q.when(self.projects);
      };
    }
  ]);
