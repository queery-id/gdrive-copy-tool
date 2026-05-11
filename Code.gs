/**
 * Google Drive Copy Tool
 * Copy files and folders from "Shared with me" to My Drive
 * 
 * @author queery-id
 * @website https://queery.my.id/
 * @github https://github.com/queery-id
 * @license MIT
 * @version 1.1.0
 * @date 2026-01-05
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
 * Get list of files and folders shared with the user
 */
function getSharedFiles(fileType) {
  try {
    var items = [];
    var fileCount = 0;
    var folderCount = 0;
    var maxFiles = 450;   // Reserve slots for files
    var maxFolders = 50;  // Reserve slots for folders
    
    // If filtering for folders only, skip file search
    var searchFiles = (fileType !== 'folders');
    var searchFolders = (fileType === 'all' || fileType === 'folders');
    
    // Search for shared FILES first
    if (searchFiles) {
      var fileQuery = 'sharedWithMe = true';
      
      // Add file type filter
      if (fileType && fileType !== 'all') {
        var mimeTypes = {
          'documents': "mimeType = 'application/vnd.google-apps.document'",
          'spreadsheets': "mimeType = 'application/vnd.google-apps.spreadsheet'",
          'presentations': "mimeType = 'application/vnd.google-apps.presentation'",
          'pdfs': "mimeType = 'application/pdf'",
          'images': "mimeType contains 'image/'"
        };
        
        if (mimeTypes[fileType]) {
          fileQuery += ' and ' + mimeTypes[fileType];
        }
      }
      
      Logger.log('File Query: ' + fileQuery);
      
      var fileIterator = DriveApp.searchFiles(fileQuery);
      
      while (fileIterator.hasNext() && fileCount < maxFiles) {
        var file = fileIterator.next();
        try {
          // Skip folders from file search (they shouldn't appear but just in case)
          if (file.getMimeType() === 'application/vnd.google-apps.folder') continue;
          
          var ownerName = 'Unknown';
          try {
            var owner = file.getOwner();
            if (owner) ownerName = owner.getName() || owner.getEmail() || 'Unknown';
          } catch(e) {}
          
          var lastUpdated = file.getLastUpdated();
          
          items.push({
            id: file.getId(),
            name: file.getName(),
            type: file.getMimeType(),
            isFolder: false,
            itemCount: 0,
            size: formatFileSize(file.getSize()),
            sizeBytes: file.getSize(),
            owner: ownerName,
            lastUpdated: lastUpdated.toLocaleDateString(),
            lastUpdatedRaw: lastUpdated.getTime()
          });
          fileCount++;
        } catch (e) {
          Logger.log('Skipping file: ' + e.toString());
        }
      }
    }
    
    // Search for shared FOLDERS (separate API call)
    if (searchFolders) {
      Logger.log('Searching for shared folders...');
      
      try {
        var folderIterator = DriveApp.searchFolders('sharedWithMe = true');
        
        while (folderIterator.hasNext() && folderCount < maxFolders) {
          var folder = folderIterator.next();
          try {
            var ownerName = 'Unknown';
            try {
              var owner = folder.getOwner();
              if (owner) ownerName = owner.getName() || owner.getEmail() || 'Unknown';
            } catch(e) {}
            
            var lastUpdated = folder.getLastUpdated();
            
            // Count items in folder
            var itemCount = 0;
            try {
              var folderFiles = folder.getFiles();
              var folderFolders = folder.getFolders();
              while (folderFiles.hasNext()) { folderFiles.next(); itemCount++; }
              while (folderFolders.hasNext()) { folderFolders.next(); itemCount++; }
            } catch(e) {}
            
            items.push({
              id: folder.getId(),
              name: folder.getName(),
              type: 'application/vnd.google-apps.folder',
              isFolder: true,
              itemCount: itemCount,
              size: itemCount + ' items',
              sizeBytes: 0,
              owner: ownerName,
              lastUpdated: lastUpdated.toLocaleDateString(),
              lastUpdatedRaw: lastUpdated.getTime()
            });
            folderCount++;
          } catch (e) {
            Logger.log('Skipping folder: ' + e.toString());
          }
        }
      } catch(e) {
        Logger.log('Folder search error: ' + e.toString());
      }
    }
    
    // Sort by newest first (default)
    items.sort(function(a, b) {
      return b.lastUpdatedRaw - a.lastUpdatedRaw;
    });
    
    Logger.log('Loaded ' + items.length + ' shared items (files + folders)');
    return { success: true, files: items, count: items.length };
  } catch (e) {
    Logger.log('getSharedFiles error: ' + e.toString());
    return { success: false, error: e.toString(), files: [], count: 0 };
  }
}

/**
 * Copy selected files/folders to target folder
 */
function copyFiles(itemIds, targetFolderId, skipDuplicates) {
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
    
    // Get existing names in target folder if skip duplicates
    var existingNames = {};
    var existingFolderNames = {};
    if (skipDuplicates) {
      var existingFiles = targetFolder.getFiles();
      while (existingFiles.hasNext()) {
        existingNames[existingFiles.next().getName().toLowerCase()] = true;
      }
      var existingFolders = targetFolder.getFolders();
      while (existingFolders.hasNext()) {
        existingFolderNames[existingFolders.next().getName().toLowerCase()] = true;
      }
    }
    
    for (var i = 0; i < itemIds.length; i++) {
      try {
        // Try to get as file first
        var item;
        var isFolder = false;
        
        try {
          item = DriveApp.getFileById(itemIds[i]);
          isFolder = (item.getMimeType() === 'application/vnd.google-apps.folder');
        } catch(e) {
          // If file fails, try as folder
          item = DriveApp.getFolderById(itemIds[i]);
          isFolder = true;
        }
        
        var itemName = item.getName();
        
        if (isFolder) {
          // Handle folder copy
          var sourceFolder = DriveApp.getFolderById(itemIds[i]);
          
          // Check for duplicate folder
          if (skipDuplicates && existingFolderNames[itemName.toLowerCase()]) {
            results.skipped++;
            results.details.push({
              name: '📁 ' + itemName,
              status: 'skipped',
              reason: 'Folder already exists'
            });
            continue;
          }
          
          // Copy folder recursively
          var folderResult = copyFolderRecursive(sourceFolder, targetFolder, skipDuplicates);
          results.success += folderResult.success;
          results.skipped += folderResult.skipped;
          results.failed += folderResult.failed;
          results.details.push({
            name: '📁 ' + itemName,
            status: 'success',
            reason: 'Copied ' + folderResult.success + ' files'
          });
          
        } else {
          // Handle file copy (existing logic)
          if (skipDuplicates && existingNames[itemName.toLowerCase()]) {
            results.skipped++;
            results.details.push({
              name: itemName,
              status: 'skipped',
              reason: 'Already exists'
            });
            continue;
          }
          
          var copiedFile = item.makeCopy(itemName, targetFolder);
          results.success++;
          results.details.push({
            name: itemName,
            status: 'success',
            newId: copiedFile.getId()
          });
        }
        
      } catch (e) {
        results.failed++;
        results.details.push({
          name: itemIds[i],
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
 * Recursively copy a folder and all its contents
 */
function copyFolderRecursive(sourceFolder, destParent, skipDuplicates) {
  var result = { success: 0, skipped: 0, failed: 0 };
  
  try {
    // Create new folder in destination
    var newFolder = destParent.createFolder(sourceFolder.getName());
    
    // Get existing names if skip duplicates
    var existingNames = {};
    if (skipDuplicates) {
      var existingFiles = newFolder.getFiles();
      while (existingFiles.hasNext()) {
        existingNames[existingFiles.next().getName().toLowerCase()] = true;
      }
    }
    
    // Copy all files in the folder
    var files = sourceFolder.getFiles();
    while (files.hasNext()) {
      try {
        var file = files.next();
        var fileName = file.getName();
        
        if (skipDuplicates && existingNames[fileName.toLowerCase()]) {
          result.skipped++;
          continue;
        }
        
        file.makeCopy(fileName, newFolder);
        result.success++;
      } catch(e) {
        result.failed++;
        Logger.log('Failed to copy file in folder: ' + e.toString());
      }
    }
    
    // Recursively copy subfolders
    var subfolders = sourceFolder.getFolders();
    while (subfolders.hasNext()) {
      var subfolder = subfolders.next();
      var subResult = copyFolderRecursive(subfolder, newFolder, skipDuplicates);
      result.success += subResult.success;
      result.skipped += subResult.skipped;
      result.failed += subResult.failed;
    }
    
  } catch(e) {
    Logger.log('copyFolderRecursive error: ' + e.toString());
    result.failed++;
  }
  
  return result;
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
 * Parse Google Drive URL to extract file/folder ID
 * Supports multiple URL formats:
 * - https://drive.google.com/file/d/{id}/view
 * - https://drive.google.com/drive/folders/{id}
 * - https://docs.google.com/document/d/{id}/edit
 * - https://docs.google.com/spreadsheets/d/{id}/edit
 * - https://docs.google.com/presentation/d/{id}/edit
 * - https://drive.google.com/open?id={id}
 * - Raw ID (no URL)
 */
function parseGoogleDriveUrl(url) {
  if (!url || url.trim() === '') {
    return { success: false, error: 'Empty URL' };
  }
  
  url = url.trim();
  
  // Pattern 1: /d/{id}/ format (files, docs, sheets, slides)
  var match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return { success: true, id: match[1] };
  
  // Pattern 2: /folders/{id} format
  match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return { success: true, id: match[1] };
  
  // Pattern 3: ?id={id} format (open?id=)
  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return { success: true, id: match[1] };
  
  // Pattern 4: Raw ID (no slashes, no dots, looks like a Drive ID)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(url)) {
    return { success: true, id: url };
  }
  
  return { success: false, error: 'Could not extract ID from URL: ' + url };
}

/**
 * Get file/folder info by ID (for URL-added items)
 */
function getItemInfoById(fileId) {
  try {
    // Try as file first
    try {
      var file = DriveApp.getFileById(fileId);
      var isFolder = (file.getMimeType() === 'application/vnd.google-apps.folder');
      
      if (isFolder) {
        // Re-fetch as folder for proper metadata
        return getFolderInfoById(fileId);
      }
      
      var ownerName = 'Unknown';
      try {
        var owner = file.getOwner();
        if (owner) ownerName = owner.getName() || owner.getEmail() || 'Unknown';
      } catch(e) {}
      
      var lastUpdated = file.getLastUpdated();
      
      return {
        success: true,
        item: {
          id: file.getId(),
          name: file.getName(),
          type: file.getMimeType(),
          isFolder: false,
          itemCount: 0,
          size: formatFileSize(file.getSize()),
          sizeBytes: file.getSize(),
          owner: ownerName,
          lastUpdated: lastUpdated.toLocaleDateString(),
          lastUpdatedRaw: lastUpdated.getTime(),
          addedViaUrl: true
        }
      };
    } catch(e) {
      // Not a file, try as folder
      return getFolderInfoById(fileId);
    }
  } catch(e) {
    return { success: false, error: 'Cannot access item: ' + e.toString() };
  }
}

/**
 * Helper: Get folder info by ID
 */
function getFolderInfoById(folderId) {
  try {
    var folder = DriveApp.getFolderById(folderId);
    
    var ownerName = 'Unknown';
    try {
      var owner = folder.getOwner();
      if (owner) ownerName = owner.getName() || owner.getEmail() || 'Unknown';
    } catch(e) {}
    
    var lastUpdated = folder.getLastUpdated();
    
    // Count items in folder
    var itemCount = 0;
    try {
      var folderFiles = folder.getFiles();
      var folderFolders = folder.getFolders();
      while (folderFiles.hasNext()) { folderFiles.next(); itemCount++; }
      while (folderFolders.hasNext()) { folderFolders.next(); itemCount++; }
    } catch(e) {}
    
    return {
      success: true,
      item: {
        id: folder.getId(),
        name: folder.getName(),
        type: 'application/vnd.google-apps.folder',
        isFolder: true,
        itemCount: itemCount,
        size: itemCount + ' items',
        sizeBytes: 0,
        owner: ownerName,
        lastUpdated: lastUpdated.toLocaleDateString(),
        lastUpdatedRaw: lastUpdated.getTime(),
        addedViaUrl: true
      }
    };
  } catch(e) {
    return { success: false, error: 'Cannot access folder: ' + e.toString() };
  }
}

/**
 * Bulk resolve URLs to item metadata
 * @param {string[]} urls - Array of Google Drive URLs
 * @returns {Object} { success: boolean, items: [], errors: [] }
 */
function addItemsByUrls(urls) {
  var items = [];
  var errors = [];
  
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i].trim();
    if (!url) continue; // Skip empty lines
    
    var parsed = parseGoogleDriveUrl(url);
    
    if (!parsed.success) {
      errors.push({ url: url, error: parsed.error });
      continue;
    }
    
    var itemInfo = getItemInfoById(parsed.id);
    
    if (!itemInfo.success) {
      errors.push({ url: url, error: itemInfo.error });
      continue;
    }
    
    // Check for duplicate (same ID already in items)
    var isDuplicate = false;
    for (var j = 0; j < items.length; j++) {
      if (items[j].id === itemInfo.item.id) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      items.push(itemInfo.item);
    }
  }
  
  return { success: true, items: items, errors: errors };
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
