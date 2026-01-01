/**
 * Google Drive Copy Tool
 * Copy files from "Shared with me" to My Drive
 * 
 * @author queery-id
 * @website https://queery.my.id/
 * @github https://github.com/queery-id
 * @license MIT
 * @version 1.0.0
 * @date 2026-01-01
 */

/**
 * Serve the web app HTML
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Google Drive Copy Tool')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Get user info for display
 */
function getUserInfo() {
  try {
    var email = Session.getActiveUser().getEmail();
    if (!email || email === '') {
      return { success: true, email: 'Anonymous User (Authorization needed)' };
    }
    return { success: true, email: email };
  } catch (e) {
    Logger.log('getUserInfo error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Get list of folders in My Drive for dropdown
 */
function getMyDriveFolders() {
  try {
    var folders = [];
    
    // Add root folder option first
    folders.push({
      id: 'root',
      name: '📁 My Drive (Root)'
    });
    
    // Get folders - limit to first 50 to avoid timeout
    var folderIterator = DriveApp.getFolders();
    var count = 0;
    var maxFolders = 50;
    
    while (folderIterator.hasNext() && count < maxFolders) {
      var folder = folderIterator.next();
      try {
        folders.push({
          id: folder.getId(),
          name: '📂 ' + folder.getName()
        });
        count++;
      } catch (e) {
        // Skip folders with access issues
        Logger.log('Skipping folder: ' + e.toString());
      }
    }
    
    Logger.log('Loaded ' + folders.length + ' folders');
    return { success: true, folders: folders };
  } catch (e) {
    Logger.log('getMyDriveFolders error: ' + e.toString());
    return { success: false, error: e.toString(), folders: [{id: 'root', name: '📁 My Drive (Root)'}] };
  }
}

/**
 * Get list of files shared with the user
 */
function getSharedFiles(fileType) {
  try {
    var files = [];
    var query = 'sharedWithMe = true';
    
    // Add file type filter
    if (fileType && fileType !== 'all') {
      var mimeTypes = {
        'documents': "mimeType = 'application/vnd.google-apps.document'",
        'spreadsheets': "mimeType = 'application/vnd.google-apps.spreadsheet'",
        'presentations': "mimeType = 'application/vnd.google-apps.presentation'",
        'pdfs': "mimeType = 'application/pdf'",
        'images': "mimeType contains 'image/'",
        'folders': "mimeType = 'application/vnd.google-apps.folder'"
      };
      
      if (mimeTypes[fileType]) {
        query += ' and ' + mimeTypes[fileType];
      }
    }
    
    Logger.log('Query: ' + query);
    
    var fileIterator = DriveApp.searchFiles(query);
    var count = 0;
    var maxFiles = 500; // Increased limit for more files
    
    while (fileIterator.hasNext() && count < maxFiles) {
      var file = fileIterator.next();
      try {
        var ownerName = 'Unknown';
        try {
          var owner = file.getOwner();
          if (owner) ownerName = owner.getName() || owner.getEmail() || 'Unknown';
        } catch(e) {}
        
        var lastUpdated = file.getLastUpdated();
        
        files.push({
          id: file.getId(),
          name: file.getName(),
          type: file.getMimeType(),
          size: formatFileSize(file.getSize()),
          sizeBytes: file.getSize(),
          owner: ownerName,
          lastUpdated: lastUpdated.toLocaleDateString(),
          lastUpdatedRaw: lastUpdated.getTime() // For sorting
        });
        count++;
      } catch (e) {
        Logger.log('Skipping file: ' + e.toString());
      }
    }
    
    // Sort by newest first (default)
    files.sort(function(a, b) {
      return b.lastUpdatedRaw - a.lastUpdatedRaw;
    });
    
    Logger.log('Loaded ' + files.length + ' shared files');
    return { success: true, files: files, count: files.length };
  } catch (e) {
    Logger.log('getSharedFiles error: ' + e.toString());
    return { success: false, error: e.toString(), files: [], count: 0 };
  }
}

/**
 * Copy selected files to target folder
 */
function copyFiles(fileIds, targetFolderId, skipDuplicates) {
  var results = {
    success: 0,
    skipped: 0,
    failed: 0,
    details: []
  };
  
  try {
    var targetFolder;
    if (targetFolderId === 'root') {
      targetFolder = DriveApp.getRootFolder();
    } else {
      targetFolder = DriveApp.getFolderById(targetFolderId);
    }
    
    // Get existing file names in target folder if skip duplicates
    var existingNames = {};
    if (skipDuplicates) {
      var existingFiles = targetFolder.getFiles();
      while (existingFiles.hasNext()) {
        var ef = existingFiles.next();
        existingNames[ef.getName().toLowerCase()] = true;
      }
    }
    
    for (var i = 0; i < fileIds.length; i++) {
      try {
        var file = DriveApp.getFileById(fileIds[i]);
        var fileName = file.getName();
        
        // Check for duplicates
        if (skipDuplicates && existingNames[fileName.toLowerCase()]) {
          results.skipped++;
          results.details.push({
            name: fileName,
            status: 'skipped',
            reason: 'Already exists'
          });
          continue;
        }
        
        // Copy the file
        var copiedFile = file.makeCopy(fileName, targetFolder);
        results.success++;
        results.details.push({
          name: fileName,
          status: 'success',
          newId: copiedFile.getId()
        });
        
      } catch (e) {
        results.failed++;
        results.details.push({
          name: fileIds[i],
          status: 'failed',
          reason: e.toString()
        });
      }
    }
    
    return { success: true, results: results };
  } catch (e) {
    Logger.log('copyFiles error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Format file size to human readable
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  var k = 1024;
  var sizes = ['Bytes', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Test function - run this manually to verify Drive access
 */
function testDriveAccess() {
  Logger.log('Testing Drive access...');
  
  var userInfo = getUserInfo();
  Logger.log('User: ' + JSON.stringify(userInfo));
  
  var folders = getMyDriveFolders();
  Logger.log('Folders count: ' + (folders.folders ? folders.folders.length : 'error'));
  
  var files = getSharedFiles('all');
  Logger.log('Shared files count: ' + (files.count || 'error'));
  
  return {
    user: userInfo,
    foldersCount: folders.folders ? folders.folders.length : 0,
    sharedFilesCount: files.count || 0
  };
}
