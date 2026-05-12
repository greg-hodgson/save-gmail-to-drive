const USER_PROP_DESTINATIONS = 'SAVED_DESTINATIONS_JSON';
const USER_PROP_LAST_FOLDER_ID = 'LAST_SELECTED_FOLDER_ID';

// Per-thread tracked-thread storage
const USER_PROP_TRACKED_THREAD_PREFIX = 'TRACKED_THREAD_';

// Obsolete index property from earlier version, retained only so older installs
// can safely ignore/clean it up if present.
const USER_PROP_TRACKED_THREAD_INDEX = 'TRACKED_THREAD_INDEX_JSON';

// Legacy property from earlier version, for migration if needed
const LEGACY_USER_PROP_TRACKED_THREADS = 'TRACKED_THREADS_JSON';

const AUTO_SAVE_TRIGGER_FUNCTION = 'processTrackedThreads';
const AUTO_SAVE_INTERVAL_HOURS = 1;

const USER_LOCK_TIMEOUT_MS = 30000;

/**
 * Gmail contextual add-on entry point.
 */
function buildGmailCard(e) {
  return buildMainCard_(e, getSelectedFolderId_(e));
}

/**
 * Builds the main add-on card.
 */
function buildMainCard_(e, selectedFolderId) {
  migrateLegacyTrackedThreadsIfNeeded_();

  const destinations = getDestinations_();
  const currentMessageId = getCurrentMessageId_(e);
  const currentThreadId = getCurrentThreadId_(e);
  const trackedThread = currentThreadId ? getTrackedThread_(currentThreadId) : null;
  const trackedThreads = sortTrackedThreadsForDisplay_(getTrackedThreads_(), currentThreadId);

  const preferredSelectedFolderId =
    (trackedThread && trackedThread.folderId) || selectedFolderId;

  const normalizedSelectedFolderId = normalizeSelectedFolderId_(
    preferredSelectedFolderId,
    destinations
  );

  const selectedDestination =
    destinations.find(d => d.folderId === normalizedSelectedFolderId) || null;

  const trackedDestination =
    trackedThread
      ? destinations.find(d => d.folderId === trackedThread.folderId) || null
      : null;

  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Save Email as EML'));

  // Section: save current email
  const saveSection = CardService.newCardSection()
    .setHeader('Save current email');

  if (destinations.length > 0) {
    const dropdown = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('selectedFolderId')
      .setTitle('Saved destination')
      .setOnChangeAction(
        buildAction_(
          'onDestinationChanged',
          buildContextParams_(currentMessageId, currentThreadId)
        )
      );

    destinations.forEach(dest => {
      dropdown.addItem(
        dest.name,
        dest.folderId,
        dest.folderId === normalizedSelectedFolderId
      );
    });

    saveSection.addWidget(dropdown);

    if (currentThreadId) {
      saveSection.addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.CHECK_BOX)
          .setFieldName('autoSaveThread')
          .setTitle('Automatic saving')
          .addItem(
            'Automatically save emails in this thread every hour',
            'true',
            !!trackedThread
          )
          .setOnChangeAction(
            buildAction_(
              'toggleThreadAutoSave',
              buildContextParams_(currentMessageId, currentThreadId)
            )
          )
      );
    }

    if (trackedThread) {
      let statusText = 'Auto-save is currently <b>ON</b> for this thread';

      if (trackedDestination) {
        statusText += ' to <b>' + escapeHtml_(trackedDestination.name) + '</b>.';
      } else {
        statusText += '.';
      }

      if (trackedThread.lastStatus) {
        statusText += '<br/>' + escapeHtml_(trackedThread.lastStatus);
      }

      if (trackedThread.lastCheckedAt) {
        statusText += '<br/>Last checked: ' + escapeHtml_(formatIsoForDisplay_(trackedThread.lastCheckedAt));
      }

      saveSection.addWidget(
        CardService.newTextParagraph().setText(statusText)
      );
    } else if (currentThreadId) {
      saveSection.addWidget(
        CardService.newTextParagraph().setText(
          'Tip: enable automatic saving to immediately check this conversation and then keep checking every hour.'
        )
      );
    }
  } else {
    saveSection.addWidget(
      CardService.newTextParagraph().setText(
        'No saved destinations yet. Add one below, then select it from the dropdown.'
      )
    );
  }

  saveSection.addWidget(
    CardService.newTextButton()
      .setText('Save current email as .eml')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(
        buildAction_(
          'saveCurrentMessageAsEml',
          buildContextParams_(currentMessageId, currentThreadId)
        )
      )
  );

  saveSection.addWidget(
    CardService.newTextButton()
      .setText('Save attachments')
      .setOnClickAction(
        buildAction_(
          'saveCurrentMessageAttachments',
          buildContextParams_(currentMessageId, currentThreadId)
        )
      )
  );

  // Section: manage saved destinations
  const manageSection = CardService.newCardSection()
    .setHeader('Manage saved destinations')
    .addWidget(
      CardService.newTextInput()
        .setFieldName('folderName')
        .setTitle('Display name')
        .setHint('Example: Team Archive')
        .setValue(selectedDestination ? selectedDestination.name : '')
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName('folderId')
        .setTitle('Drive folder ID')
        .setHint('Paste the shared drive folder ID')
        .setValue(selectedDestination ? selectedDestination.folderId : '')
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        'Tip: select an existing destination to edit it. Saving with the same name updates its folder ID. Saving with the same folder ID updates its name.'
      )
    );

  manageSection.addWidget(
    CardService.newTextButton()
      .setText('Save / update destination')
      .setOnClickAction(
        buildAction_(
          'addOrUpdateDestination',
          buildContextParams_(currentMessageId, currentThreadId)
        )
      )
  );

  if (normalizedSelectedFolderId) {
    manageSection.addWidget(
      CardService.newTextButton()
        .setText('Open selected folder')
        .setOpenLink(
          CardService.newOpenLink().setUrl(
            buildDriveFolderUrl_(normalizedSelectedFolderId)
          )
        )
    );
  }

  manageSection.addWidget(
    CardService.newTextButton()
      .setText('Delete selected')
      .setOnClickAction(
        buildAction_(
          'deleteSelectedDestination',
          buildContextParams_(currentMessageId, currentThreadId)
        )
      )
  );

  // Section: tracked threads
  const trackedSection = CardService.newCardSection()
    .setHeader('Tracked threads');

  if (!trackedThreads.length) {
    trackedSection.addWidget(
      CardService.newTextParagraph().setText(
        'No threads are currently being tracked for automatic saving.'
      )
    );
  } else {
    trackedSection.addWidget(
      CardService.newTextParagraph().setText(
        'Currently tracking <b>' + trackedThreads.length + '</b> thread(s).'
      )
    );
  }

  trackedSection.addWidget(
    CardService.newTextButton()
      .setText('View tracked threads')
      .setOnClickAction(
        buildAction_(
          'openTrackedThreadsCard',
          buildContextParams_(currentMessageId, currentThreadId, {
            selectedFolderId: normalizedSelectedFolderId
          })
        )
      )
  );

  card
    .addSection(saveSection)
    .addSection(manageSection)
    .addSection(trackedSection);

  return card.build();
}

/**
 * Builds the tracked threads detail card.
 */
function buildTrackedThreadsCard_(e, selectedFolderId) {
  migrateLegacyTrackedThreadsIfNeeded_();

  const destinations = getDestinations_();
  const currentMessageId = getCurrentMessageId_(e);
  const currentThreadId = getCurrentThreadId_(e);
  const trackedThreads = sortTrackedThreadsForDisplay_(getTrackedThreads_(), currentThreadId);
  const normalizedSelectedFolderId = normalizeSelectedFolderId_(
    selectedFolderId,
    destinations
  );

  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Tracked threads'));

  const section = CardService.newCardSection();

  if (!trackedThreads.length) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'No threads are currently being tracked for automatic saving.'
      )
    );
  } else {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'Currently tracking <b>' + trackedThreads.length + '</b> thread(s).'
      )
    );

    trackedThreads.forEach(item => {
      const destination =
        destinations.find(d => d.folderId === item.folderId) || null;
      const isCurrent = currentThreadId && item.threadId === currentThreadId;

      let text = '<b>' + escapeHtml_(item.subject || ('Thread ' + shortId_(item.threadId))) + '</b>';

      if (isCurrent) {
        text += ' (current thread)';
      }

      const destinationName =
        destination ? destination.name : ('Folder ' + shortId_(item.folderId));

      text += '<br/>Destination: ' + buildHtmlLink_(
        buildDriveFolderUrl_(item.folderId),
        destinationName,
        true
      );

      if (item.lastCheckedAt) {
        text += '<br/>Last checked: ' + escapeHtml_(formatIsoForDisplay_(item.lastCheckedAt));
      }

      if (item.lastStatus) {
        text += '<br/>' + escapeHtml_(item.lastStatus);
      }

      section.addWidget(
        CardService.newTextParagraph().setText(text)
      );

      section.addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText(isCurrent ? 'Stop tracking current thread' : 'Stop tracking')
            .setOnClickAction(
              buildAction_(
                'removeTrackedThreadFromList',
                buildContextParams_(currentMessageId, currentThreadId, {
                  targetThreadId: item.threadId,
                  selectedFolderId: normalizedSelectedFolderId,
                  sourceView: 'trackedThreads'
                })
              )
            )
        )
      );
    });
  }

  card.addSection(section);
  return card.build();
}

/**
 * Saves the current Gmail message as .eml to the selected destination.
 */
function saveCurrentMessageAsEml(e) {
  try {
    const folderId = getSelectedFolderId_(e);
    if (!folderId) {
      throw new Error('Select a saved destination first, or add one below.');
    }

    const folder = getAccessibleFolder_(folderId);
    const message = getCurrentMessageFromContext_(e);
    const file = saveMessageToFolder_(message, folder);

    PropertiesService.getUserProperties().setProperty(USER_PROP_LAST_FOLDER_ID, folderId);

    return rebuildResponse_(
      e,
      'Saved to "' + folder.getName() + '": ' + file.getName(),
      folderId
    );

  } catch (err) {
    return rebuildResponse_(e, 'Error: ' + err.message, getSelectedFolderId_(e));
  }
}

/**
 * Saves only the non-inline attachments from the current Gmail message
 * to the selected destination folder.
 */
function saveCurrentMessageAttachments(e) {
  try {
    const folderId = getSelectedFolderId_(e);
    if (!folderId) {
      throw new Error('Select a saved destination first, or add one below.');
    }

    const folder = getAccessibleFolder_(folderId);
    const message = getCurrentMessageFromContext_(e);
    const files = saveAttachmentsToFolder_(message, folder);

    if (!files.length) {
      return rebuildResponse_(
        e,
        'No non-inline attachments were found on this email.',
        folderId
      );
    }

    PropertiesService.getUserProperties().setProperty(USER_PROP_LAST_FOLDER_ID, folderId);

    return rebuildResponse_(
      e,
      'Saved ' + files.length + ' attachment(s) to "' + folder.getName() + '".',
      folderId
    );

  } catch (err) {
    return rebuildResponse_(e, 'Error: ' + err.message, getSelectedFolderId_(e));
  }
}

/**
 * Called when the dropdown selection changes.
 * Rebuilds the card so the selected destination is loaded into the edit fields.
 * If auto-save is enabled for the current thread, this also updates the tracked destination.
 */
function onDestinationChanged(e) {
  const folderId = getSelectedFolderId_(e);
  const currentThreadId = getCurrentThreadId_(e);
  let notice = '';

  if (folderId) {
    PropertiesService.getUserProperties().setProperty(USER_PROP_LAST_FOLDER_ID, folderId);
  }

  if (folderId && currentThreadId) {
    const trackedThread = getTrackedThread_(currentThreadId);
    if (trackedThread && trackedThread.folderId !== folderId) {
      trackedThread.folderId = folderId;
      trackedThread.lastCheckedAt = new Date().toISOString();
      trackedThread.lastStatus = 'Auto-save destination updated.';
      upsertTrackedThread_(trackedThread);
      notice = 'Auto-save destination updated for this thread.';
    }
  }

  return rebuildResponse_(e, notice, folderId);
}

/**
 * Enables or disables automatic saving for the current thread.
 * On enable, existing messages in the thread are checked immediately and
 * any that are not already present in the destination folder are saved now.
 * Future trigger runs continue checking the same thread every hour.
 */
function toggleThreadAutoSave(e) {
  try {
    const enabled = !!getFormValue_(e, 'autoSaveThread');

    if (!enabled) {
      const threadIdToRemove = getCurrentThreadId_(e);
      if (!threadIdToRemove) {
        throw new Error('Could not determine the current Gmail thread.');
      }

      removeTrackedThread_(threadIdToRemove);

      return rebuildResponse_(
        e,
        'Auto-save disabled for this thread.',
        getSelectedFolderId_(e)
      );
    }

    const folderId = getSelectedFolderId_(e);
    if (!folderId) {
      throw new Error('Select a saved destination first.');
    }

    const folder = getAccessibleFolder_(folderId);
    const thread = getCurrentThreadFromContext_(e);
    const threadId = thread.getId();

    const nowIso = new Date().toISOString();
    const existing = getTrackedThread_(threadId);

    ensureAutoSaveTrigger_();

    upsertTrackedThread_({
      threadId: threadId,
      folderId: folderId,
      // Keep only what was previously known as saved.
      // Do NOT mark current messages as already accounted for.
      savedMessageIds: existing ? existing.savedMessageIds : [],
      subject: thread.getFirstMessageSubject() || (existing && existing.subject) || '',
      createdAt: (existing && existing.createdAt) || nowIso,
      lastCheckedAt: nowIso,
      lastStatus: 'Auto-save enabled for "' + folder.getName() + '".'
    });

    const syncResult = syncTrackedThreadNow_(threadId, thread);

    PropertiesService.getUserProperties().setProperty(USER_PROP_LAST_FOLDER_ID, folderId);

    let message = 'Auto-save enabled.';

    if (syncResult.savedCount) {
      message += ' Saved ' + syncResult.savedCount + ' message(s) right away.';
    } else if (syncResult.existingCount) {
      message += ' ' + syncResult.existingCount + ' message(s) were already in the folder.';
    } else {
      message += ' No unsaved messages were found right now.';
    }

    if (syncResult.failedCount) {
      message += ' ' + syncResult.failedCount + ' failed and will be retried later.';
    }

    return rebuildResponse_(e, message, folderId);

  } catch (err) {
    return rebuildResponse_(e, 'Error: ' + err.message, getSelectedFolderId_(e));
  }
}

/**
 * Opens a separate card showing all tracked threads.
 */
function openTrackedThreadsCard(e) {
  const selectedFolderId =
    (getParam_(e, 'selectedFolderId') || getSelectedFolderId_(e) || '').trim();

  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(
        buildTrackedThreadsCard_(e, selectedFolderId)
      )
    )
    .build();
}

/**
 * Removes a tracked thread from the management list.
 */
function removeTrackedThreadFromList(e) {
  const selectedFolderId =
    (getParam_(e, 'selectedFolderId') || getSelectedFolderId_(e) || '').trim();
  const sourceView = (getParam_(e, 'sourceView') || '').trim();

  try {
    const targetThreadId = (getParam_(e, 'targetThreadId') || '').trim();
    if (!targetThreadId) {
      throw new Error('No tracked thread was specified.');
    }

    const existing = getTrackedThread_(targetThreadId);
    if (!existing) {
      throw new Error('That tracked thread was not found.');
    }

    removeTrackedThread_(targetThreadId);

    const label = existing.subject
      ? '"' + existing.subject + '"'
      : 'that thread';

    if (sourceView === 'trackedThreads') {
      return rebuildTrackedThreadsResponse_(
        e,
        'Stopped tracking ' + label + '.',
        selectedFolderId
      );
    }

    return rebuildResponse_(
      e,
      'Stopped tracking ' + label + '.',
      selectedFolderId
    );

  } catch (err) {
    if (sourceView === 'trackedThreads') {
      return rebuildTrackedThreadsResponse_(
        e,
        'Error: ' + err.message,
        selectedFolderId
      );
    }

    return rebuildResponse_(
      e,
      'Error: ' + err.message,
      selectedFolderId
    );
  }
}

/**
 * Adds or updates a saved destination in User Properties.
 * If an existing destination is replaced, tracked threads using the replaced destination
 * are remapped to the new folder ID.
 */
function addOrUpdateDestination(e) {
  try {
    const enteredName = (getFormValue_(e, 'folderName') || '').trim();
    const folderId = (getFormValue_(e, 'folderId') || '').trim();

    if (!folderId) {
      throw new Error('Please enter a Drive folder ID.');
    }

    const folder = getAccessibleFolder_(folderId);
    const finalName = enteredName || folder.getName() || 'Unnamed destination';

    let destinations = getDestinations_();
    const nameKey = finalName.toLowerCase();

    const replacedFolderIds = destinations
      .filter(d => d.folderId === folderId || d.name.toLowerCase() === nameKey)
      .map(d => d.folderId)
      .filter(onlyUnique_);

    destinations = destinations.filter(d =>
      d.folderId !== folderId && d.name.toLowerCase() !== nameKey
    );

    destinations.push({
      name: finalName,
      folderId: folderId
    });

    sortDestinations_(destinations);
    setDestinations_(destinations);

    remapTrackedThreadsFolderIds_(replacedFolderIds, folderId);

    PropertiesService.getUserProperties().setProperty(USER_PROP_LAST_FOLDER_ID, folderId);

    return rebuildResponse_(
      e,
      'Saved destination "' + finalName + '".',
      folderId
    );

  } catch (err) {
    return rebuildResponse_(e, 'Error: ' + err.message, getSelectedFolderId_(e));
  }
}

/**
 * Deletes the currently selected destination.
 * Also disables auto-save for any tracked threads using this destination.
 */
function deleteSelectedDestination(e) {
  try {
    const folderId = getSelectedFolderId_(e);
    if (!folderId) {
      throw new Error('Select a saved destination to delete.');
    }

    let destinations = getDestinations_();
    const existing = destinations.find(d => d.folderId === folderId);

    if (!existing) {
      throw new Error('Selected destination was not found.');
    }

    destinations = destinations.filter(d => d.folderId !== folderId);
    setDestinations_(destinations);

    const removedTrackedCount = removeTrackedThreadsByFolderId_(folderId);

    const nextSelectedFolderId = destinations.length ? destinations[0].folderId : '';
    if (nextSelectedFolderId) {
      PropertiesService.getUserProperties().setProperty(
        USER_PROP_LAST_FOLDER_ID,
        nextSelectedFolderId
      );
    } else {
      PropertiesService.getUserProperties().deleteProperty(USER_PROP_LAST_FOLDER_ID);
    }

    let message = 'Deleted destination "' + existing.name + '".';
    if (removedTrackedCount > 0) {
      message += ' Auto-save was turned off for ' + removedTrackedCount + ' tracked thread(s).';
    }

    return rebuildResponse_(e, message, nextSelectedFolderId);

  } catch (err) {
    return rebuildResponse_(e, 'Error: ' + err.message, getSelectedFolderId_(e));
  }
}

/**
 * Builds an action with string parameters.
 */
function buildAction_(functionName, params) {
  const action = CardService.newAction().setFunctionName(functionName);
  const cleanParams = {};

  Object.keys(params || {}).forEach(key => {
    const value = params[key];
    if (value !== null && value !== undefined && value !== '') {
      cleanParams[key] = String(value);
    }
  });

  if (Object.keys(cleanParams).length) {
    action.setParameters(cleanParams);
  }

  return action;
}

/**
 * Common action parameters for current card context.
 */
function buildContextParams_(messageId, threadId, extra) {
  const params = {};

  if (messageId) {
    params.messageId = messageId;
  }
  if (threadId) {
    params.threadId = threadId;
  }

  Object.keys(extra || {}).forEach(key => {
    const value = extra[key];
    if (value !== null && value !== undefined && value !== '') {
      params[key] = value;
    }
  });

  return params;
}

/**
 * Rebuilds the main card and optionally shows a notification.
 */
function rebuildResponse_(e, text, selectedFolderId) {
  const builder = CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(
        buildMainCard_(e, selectedFolderId)
      )
    );

  if (text) {
    builder.setNotification(CardService.newNotification().setText(text));
  }

  return builder.build();
}

/**
 * Rebuilds the tracked threads card and optionally shows a notification.
 */
function rebuildTrackedThreadsResponse_(e, text, selectedFolderId) {
  const builder = CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(
        buildTrackedThreadsCard_(e, selectedFolderId)
      )
    );

  if (text) {
    builder.setNotification(CardService.newNotification().setText(text));
  }

  return builder.build();
}

/**
 * Reads a custom action parameter.
 */
function getParam_(e, paramName) {
  return (
    (e && e.parameters && e.parameters[paramName]) ||
    ''
  );
}

/**
 * Reads the current Gmail message ID from event or action parameters.
 */
function getCurrentMessageId_(e) {
  return (
    getParam_(e, 'messageId') ||
    (e && e.gmail && e.gmail.messageId) ||
    ''
  );
}

/**
 * Loads the current Gmail message from the add-on event context.
 */
function getCurrentMessageFromContext_(e) {
  const messageId = getCurrentMessageId_(e);
  const accessToken = e && e.gmail && e.gmail.accessToken;

  if (!messageId) {
    throw new Error('Could not determine the current Gmail message ID.');
  }

  if (!accessToken) {
    throw new Error('No Gmail access token was provided. Re-open the email and try again.');
  }

  GmailApp.setCurrentMessageAccessToken(accessToken);

  const message = GmailApp.getMessageById(messageId);
  if (!message) {
    throw new Error('Could not load the current Gmail message.');
  }

  return message;
}

/**
 * Loads the current Gmail thread from the add-on event context.
 */
function getCurrentThreadFromContext_(e) {
  const message = getCurrentMessageFromContext_(e);
  const thread = message.getThread();

  if (!thread) {
    throw new Error('Could not load the current Gmail thread.');
  }

  return thread;
}

/**
 * Reads the current Gmail thread ID from event or action parameters.
 * Falls back to loading the current message and reading its thread ID.
 */
function getCurrentThreadId_(e) {
  const fromParams = getParam_(e, 'threadId');
  if (fromParams) {
    return fromParams;
  }

  const fromEvent = (e && e.gmail && e.gmail.threadId) || '';
  if (fromEvent) {
    return fromEvent;
  }

  try {
    return getCurrentThreadFromContext_(e).getId();
  } catch (err) {
    return '';
  }
}

/**
 * Gets the currently selected folder ID from form state, tracked thread state, or user properties.
 */
function getSelectedFolderId_(e) {
  const fromForm = (getFormValue_(e, 'selectedFolderId') || '').trim();
  if (fromForm) {
    return fromForm;
  }

  const destinations = getDestinations_();
  const currentThreadId = getCurrentThreadId_(e);
  const trackedThread = currentThreadId ? getTrackedThread_(currentThreadId) : null;

  if (
    trackedThread &&
    trackedThread.folderId &&
    destinations.some(d => d.folderId === trackedThread.folderId)
  ) {
    return trackedThread.folderId;
  }

  const lastFolderId =
    (PropertiesService.getUserProperties().getProperty(USER_PROP_LAST_FOLDER_ID) || '').trim();

  if (lastFolderId && destinations.some(d => d.folderId === lastFolderId)) {
    return lastFolderId;
  }

  return destinations.length ? destinations[0].folderId : '';
}

/**
 * Ensures selectedFolderId exists in the current destination list.
 */
function normalizeSelectedFolderId_(selectedFolderId, destinations) {
  if (selectedFolderId && destinations.some(d => d.folderId === selectedFolderId)) {
    return selectedFolderId;
  }

  const lastFolderId =
    (PropertiesService.getUserProperties().getProperty(USER_PROP_LAST_FOLDER_ID) || '').trim();

  if (lastFolderId && destinations.some(d => d.folderId === lastFolderId)) {
    return lastFolderId;
  }

  return destinations.length ? destinations[0].folderId : '';
}

/**
 * Loads saved destinations from User Properties.
 */
function getDestinations_() {
  const raw = PropertiesService.getUserProperties().getProperty(USER_PROP_DESTINATIONS);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(item => item && item.name && item.folderId)
      .map(item => ({
        name: String(item.name),
        folderId: String(item.folderId)
      }));
  } catch (err) {
    return [];
  }
}

/**
 * Saves destinations to User Properties.
 */
function setDestinations_(destinations) {
  if (!destinations || !destinations.length) {
    PropertiesService.getUserProperties().deleteProperty(USER_PROP_DESTINATIONS);
    return;
  }

  PropertiesService.getUserProperties().setProperty(
    USER_PROP_DESTINATIONS,
    JSON.stringify(destinations)
  );
}

/**
 * Sorts destinations alphabetically by name.
 */
function sortDestinations_(destinations) {
  destinations.sort(function(a, b) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/**
 * Verifies that the ID refers to a folder the user can access.
 */
function getAccessibleFolder_(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    folder.getName(); // force access check
    return folder;
  } catch (err) {
    throw new Error(
      'Cannot access that folder. Check that the ID is a folder ID and that you have write access to that shared drive folder.'
    );
  }
}

/**
 * Reads a form field value from add-on event object.
 */
function getFormValue_(e, fieldName) {
  const input =
    e &&
    e.commonEventObject &&
    e.commonEventObject.formInputs &&
    e.commonEventObject.formInputs[fieldName];

  if (!input) return '';

  if (
    input.stringInputs &&
    input.stringInputs.value &&
    input.stringInputs.value.length
  ) {
    return input.stringInputs.value[0];
  }

  if (
    input[''] &&
    input[''].stringInputs &&
    input[''].stringInputs.value &&
    input[''].stringInputs.value.length
  ) {
    return input[''].stringInputs.value[0];
  }

  return '';
}

/**
 * Saves a Gmail message as an .eml file into the given folder.
 */
function saveMessageToFolder_(message, folder) {
  const filename = buildMessageFilename_(message);
  const rawContent = message.getRawContent();
  const blob = Utilities.newBlob(rawContent, 'message/rfc822', filename);
  return folder.createFile(blob);
}

/**
 * Saves only non-inline attachments from a Gmail message into the given folder.
 * Returns the created Drive files.
 */
function saveAttachmentsToFolder_(message, folder) {
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true
  }) || [];

  const files = [];

  attachments.forEach(function(attachment, index) {
    const blob = attachment.copyBlob();
    const safeName = buildAttachmentFilename_(blob.getName(), index + 1);
    blob.setName(safeName);
    files.push(folder.createFile(blob));
  });

  return files;
}

/**
 * Background job run by a time-driven trigger every hour.
 * Saves any messages in tracked threads that are not already accounted for
 * and not already present in the destination folder.
 */
function processTrackedThreads() {
  migrateLegacyTrackedThreadsIfNeeded_();

  const threadIds = getTrackedThreadIds_();
  if (!threadIds.length) return;

  threadIds.forEach(threadId => {
    try {
      syncTrackedThreadNow_(threadId);
    } catch (err) {
      const nowIso = new Date().toISOString();

      withUserLock_(function() {
        const raw = PropertiesService.getUserProperties().getProperty(
          trackedThreadPropKey_(threadId)
        );
        if (!raw) {
          return;
        }

        try {
          const latest = normalizeTrackedThreadRuntime_(JSON.parse(raw));
          latest.lastCheckedAt = nowIso;
          latest.lastStatus = 'Error: ' + err.message;
          upsertTrackedThreadNoLock_(latest);
        } catch (parseErr) {
          Logger.log(
            'Failed to record error status for tracked thread ' + threadId +
            ': ' + parseErr.message
          );
        }
      });
    }
  });
}

/**
 * Ensures the hourly background trigger exists for the current user.
 */
function ensureAutoSaveTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(t =>
    t.getHandlerFunction() === AUTO_SAVE_TRIGGER_FUNCTION
  );

  if (!exists) {
    ScriptApp.newTrigger(AUTO_SAVE_TRIGGER_FUNCTION)
      .timeBased()
      .everyHours(AUTO_SAVE_INTERVAL_HOURS)
      .create();
  }
}

/**
 * Optional manual helper: creates the hourly trigger.
 */
function createAutoSaveTrigger() {
  ensureAutoSaveTrigger_();
}

/**
 * Optional manual helper: deletes the hourly trigger.
 */
function deleteAutoSaveTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === AUTO_SAVE_TRIGGER_FUNCTION)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/**
 * Runs a function under a user-scoped lock.
 */
function withUserLock_(fn) {
  const lock = LockService.getUserLock();
  lock.waitLock(USER_LOCK_TIMEOUT_MS);

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns all tracked thread IDs by scanning per-thread properties directly.
 * This avoids relying on a separate index property, which could get out of sync.
 */
function getTrackedThreadIds_() {
  migrateLegacyTrackedThreadsIfNeeded_();

  const props = PropertiesService.getUserProperties().getProperties();

  return uniqueNonEmptyStrings_(
    Object.keys(props)
      .filter(key =>
        key.indexOf(USER_PROP_TRACKED_THREAD_PREFIX) === 0 &&
        key !== USER_PROP_TRACKED_THREAD_INDEX
      )
      .map(key => key.substring(USER_PROP_TRACKED_THREAD_PREFIX.length))
  );
}

/**
 * Property key for a tracked thread record.
 */
function trackedThreadPropKey_(threadId) {
  return USER_PROP_TRACKED_THREAD_PREFIX + String(threadId || '').trim();
}

/**
 * Loads one tracked thread record.
 */
function getTrackedThread_(threadId) {
  if (!threadId) return null;

  migrateLegacyTrackedThreadsIfNeeded_();

  const raw = PropertiesService.getUserProperties().getProperty(trackedThreadPropKey_(threadId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const item = normalizeTrackedThreadRuntime_(parsed);

    if (!item.threadId || !item.folderId) {
      return null;
    }

    return item;
  } catch (err) {
    return null;
  }
}

/**
 * Loads all tracked thread records.
 */
function getTrackedThreads_() {
  return getTrackedThreadIds_()
    .map(threadId => getTrackedThread_(threadId))
    .filter(Boolean);
}

/**
 * Inserts or updates one tracked thread record with locking.
 */
function upsertTrackedThread_(item) {
  return withUserLock_(function() {
    return upsertTrackedThreadNoLock_(item);
  });
}

/**
 * Inserts or updates one tracked thread record without locking.
 * Use only when caller already holds the lock.
 */
function upsertTrackedThreadNoLock_(item) {
  const normalized = normalizeTrackedThreadRuntime_(item);
  if (!normalized.threadId || !normalized.folderId) {
    return;
  }

  PropertiesService.getUserProperties().setProperty(
    trackedThreadPropKey_(normalized.threadId),
    JSON.stringify(serializeTrackedThread_(normalized))
  );
}

/**
 * Removes one tracked thread by thread ID with locking.
 */
function removeTrackedThread_(threadId) {
  return withUserLock_(function() {
    return removeTrackedThreadNoLock_(threadId);
  });
}

/**
 * Removes one tracked thread by thread ID without locking.
 * Use only when caller already holds the lock.
 */
function removeTrackedThreadNoLock_(threadId) {
  const cleanThreadId = String(threadId || '').trim();
  if (!cleanThreadId) return;

  PropertiesService.getUserProperties().deleteProperty(
    trackedThreadPropKey_(cleanThreadId)
  );
}

/**
 * Removes all tracked threads that point to a specific folder ID.
 * Returns the number removed.
 */
function removeTrackedThreadsByFolderId_(folderId) {
  return withUserLock_(function() {
    const tracked = getTrackedThreads_();
    let removed = 0;

    tracked.forEach(item => {
      if (item.folderId === folderId) {
        removeTrackedThreadNoLock_(item.threadId);
        removed++;
      }
    });

    return removed;
  });
}

/**
 * Remaps tracked threads from old folder IDs to a new folder ID.
 * Useful when a saved destination is updated.
 */
function remapTrackedThreadsFolderIds_(oldFolderIds, newFolderId) {
  if (!oldFolderIds || !oldFolderIds.length || !newFolderId) {
    return;
  }

  const oldIdSet = {};
  oldFolderIds.forEach(id => {
    const clean = String(id || '').trim();
    if (clean && clean !== newFolderId) {
      oldIdSet[clean] = true;
    }
  });

  withUserLock_(function() {
    const tracked = getTrackedThreads_();
    const nowIso = new Date().toISOString();

    tracked.forEach(item => {
      if (oldIdSet[item.folderId]) {
        item.folderId = newFolderId;
        item.lastCheckedAt = nowIso;
        item.lastStatus = 'Destination updated.';
        upsertTrackedThreadNoLock_(item);
      }
    });
  });
}

/**
 * Migrates the old single-property tracked-thread storage, if it exists.
 * New storage is one property per tracked thread.
 */
function migrateLegacyTrackedThreadsIfNeeded_() {
  return withUserLock_(function() {
    const props = PropertiesService.getUserProperties();
    const legacyRaw = props.getProperty(LEGACY_USER_PROP_TRACKED_THREADS);

    if (!legacyRaw) {
      if (props.getProperty(USER_PROP_TRACKED_THREAD_INDEX)) {
        props.deleteProperty(USER_PROP_TRACKED_THREAD_INDEX);
      }
      return;
    }

    try {
      const parsed = JSON.parse(legacyRaw);
      if (!Array.isArray(parsed)) {
        props.deleteProperty(LEGACY_USER_PROP_TRACKED_THREADS);
        props.deleteProperty(USER_PROP_TRACKED_THREAD_INDEX);
        return;
      }

      parsed.forEach(item => {
        const normalized = normalizeTrackedThreadRuntime_(item);
        if (!normalized.threadId || !normalized.folderId) {
          return;
        }

        props.setProperty(
          trackedThreadPropKey_(normalized.threadId),
          JSON.stringify(serializeTrackedThread_(normalized))
        );
      });

      props.deleteProperty(LEGACY_USER_PROP_TRACKED_THREADS);
      props.deleteProperty(USER_PROP_TRACKED_THREAD_INDEX);

    } catch (err) {
      props.deleteProperty(LEGACY_USER_PROP_TRACKED_THREADS);
      props.deleteProperty(USER_PROP_TRACKED_THREAD_INDEX);
    }
  });
}

/**
 * Normalizes a tracked thread into runtime form.
 */
function normalizeTrackedThreadRuntime_(item) {
  const arrayIds = Array.isArray(item && item.savedMessageIds) ? item.savedMessageIds : [];
  const csvIds = item && item.savedMessageIdsCsv
    ? String(item.savedMessageIdsCsv).split(',')
    : [];

  let legacyLastMessageCount = Number(
    item && (
      item.legacyLastMessageCount ||
      item.lastMessageCount ||
      0
    )
  );

  if (!isFinite(legacyLastMessageCount) || legacyLastMessageCount < 0) {
    legacyLastMessageCount = 0;
  }

  return {
    threadId: String(item && item.threadId || '').trim(),
    folderId: String(item && item.folderId || '').trim(),
    savedMessageIds: uniqueNonEmptyStrings_(arrayIds.concat(csvIds)),
    subject: String(item && item.subject || ''),
    createdAt: String(item && item.createdAt || ''),
    lastCheckedAt: String(item && item.lastCheckedAt || ''),
    lastStatus: String(item && item.lastStatus || ''),
    legacyLastMessageCount: legacyLastMessageCount
  };
}

/**
 * Serializes a tracked thread into compact property form.
 */
function serializeTrackedThread_(item) {
  const normalized = normalizeTrackedThreadRuntime_(item);

  const out = {
    threadId: normalized.threadId,
    folderId: normalized.folderId,
    savedMessageIdsCsv: normalized.savedMessageIds.join(','),
    subject: normalized.subject,
    createdAt: normalized.createdAt,
    lastCheckedAt: normalized.lastCheckedAt,
    lastStatus: normalized.lastStatus
  };

  if (!normalized.savedMessageIds.length && normalized.legacyLastMessageCount > 0) {
    out.legacyLastMessageCount = normalized.legacyLastMessageCount;
  }

  return out;
}

/**
 * Builds the set of message IDs already accounted for in a tracked thread.
 * Supports legacy lastMessageCount migration.
 */
function buildAccountedMessageIdSet_(item, messages) {
  const set = new Set(uniqueNonEmptyStrings_(item.savedMessageIds || []));

  if (!set.size && item.legacyLastMessageCount > 0 && messages && messages.length) {
    const limit = Math.min(item.legacyLastMessageCount, messages.length);
    for (let i = 0; i < limit; i++) {
      set.add(messages[i].getId());
    }
  }

  return set;
}

/**
 * Immediately syncs one tracked thread:
 * - loads all messages in the thread
 * - checks whether each message is already accounted for or already exists in the folder
 * - saves only missing messages
 * - updates tracked-thread status and savedMessageIds
 */
function syncTrackedThreadNow_(threadId, providedThread) {
  const item = getTrackedThread_(threadId);
  if (!item) {
    throw new Error('Tracked thread not found.');
  }

  const nowIso = new Date().toISOString();
  const folder = getAccessibleFolder_(item.folderId);
  const thread = providedThread || GmailApp.getThreadById(item.threadId);

  if (!thread) {
    throw new Error('Thread not found.');
  }

  const messages = thread.getMessages();
  const currentMessageIds = uniqueNonEmptyStrings_(
    messages.map(m => m.getId())
  );
  const accountedSet = buildAccountedMessageIdSet_(item, messages);

  let savedCount = 0;
  let existingCount = 0;
  let failedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const messageId = message.getId();

    if (accountedSet.has(messageId)) {
      continue;
    }

    try {
      if (messageAlreadySavedInFolder_(message, folder)) {
        accountedSet.add(messageId);
        existingCount++;
        continue;
      }

      saveMessageToFolder_(message, folder);
      accountedSet.add(messageId);
      savedCount++;

    } catch (messageErr) {
      failedCount++;
      Logger.log(
        'Failed to save message ' + messageId +
        ' for thread ' + item.threadId +
        ': ' + messageErr.message
      );
    }
  }

  withUserLock_(function() {
    const raw = PropertiesService.getUserProperties().getProperty(
      trackedThreadPropKey_(threadId)
    );
    if (!raw) {
      return;
    }

    try {
      const latest = normalizeTrackedThreadRuntime_(JSON.parse(raw));

      latest.savedMessageIds = currentMessageIds.filter(id => accountedSet.has(id));
      latest.subject = thread.getFirstMessageSubject() || latest.subject || item.subject || '';
      latest.lastCheckedAt = nowIso;
      latest.lastStatus = buildTrackedThreadStatus_(
        savedCount,
        failedCount,
        existingCount
      );
      latest.legacyLastMessageCount = 0;

      upsertTrackedThreadNoLock_(latest);
    } catch (err) {
      Logger.log(
        'Failed to update tracked thread state for ' + threadId +
        ': ' + err.message
      );
    }
  });

  return {
    savedCount: savedCount,
    existingCount: existingCount,
    failedCount: failedCount
  };
}

/**
 * Builds a user-facing status string for tracked-thread processing.
 */
function buildTrackedThreadStatus_(savedCount, failedCount, existingCount) {
  savedCount = Number(savedCount || 0);
  failedCount = Number(failedCount || 0);
  existingCount = Number(existingCount || 0);

  if (!savedCount && !failedCount && !existingCount) {
    return 'No new messages.';
  }

  let text = '';

  if (savedCount) {
    text += 'Saved ' + savedCount + ' message(s).';
  }

  if (existingCount) {
    text += (text ? ' ' : '') +
      existingCount + ' message(s) already existed in the folder.';
  }

  if (failedCount) {
    if (!savedCount && !existingCount) {
      text += 'Failed to save ' + failedCount + ' message(s). Will retry later.';
    } else {
      text += (text ? ' ' : '') +
        failedCount + ' failed and will be retried.';
    }
  }

  return text || 'No new messages.';
}

/**
 * Sorts tracked threads for display.
 * Current thread first, then alphabetically by subject.
 */
function sortTrackedThreadsForDisplay_(trackedThreads, currentThreadId) {
  return trackedThreads.slice().sort(function(a, b) {
    const aIsCurrent = a.threadId === currentThreadId;
    const bIsCurrent = b.threadId === currentThreadId;

    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;

    const aKey = (a.subject || a.threadId || '').toLowerCase();
    const bKey = (b.subject || b.threadId || '').toLowerCase();

    return aKey.localeCompare(bKey);
  });
}

/**
 * Builds the current filename format for a saved .eml file.
 * Uses the FULL Gmail message ID for stronger duplicate detection.
 */
function buildFilename_(subject, internalDateMs, messageId) {
  return buildFilenameWithIdPart_(
    subject,
    internalDateMs,
    String(messageId || '').trim()
  );
}

/**
 * Builds the legacy filename format used by older versions of the script.
 * Uses only the last 10 chars of the Gmail message ID.
 */
function buildLegacyFilename_(subject, internalDateMs, messageId) {
  return buildFilenameWithIdPart_(
    subject,
    internalDateMs,
    String(messageId || '').slice(-10)
  );
}

/**
 * Shared filename builder.
 */
function buildFilenameWithIdPart_(subject, internalDateMs, idPart) {
  const d = internalDateMs ? new Date(internalDateMs) : new Date();
  const stamp =
    d.getFullYear() +
    '-' + pad2_(d.getMonth() + 1) +
    '-' + pad2_(d.getDate()) +
    '_' + pad2_(d.getHours()) +
    '-' + pad2_(d.getMinutes()) +
    '-' + pad2_(d.getSeconds());

  const safeSubject = sanitizeFilename_(subject) || 'email';
  const safeIdPart = sanitizeFilename_(idPart) || 'message';

  return stamp + ' - ' + safeSubject.slice(0, 100) + ' - ' + safeIdPart + '.eml';
}

/**
 * Builds the exact CURRENT filename this script would use for a Gmail message.
 */
function buildMessageFilename_(message) {
  return buildFilename_(
    message.getSubject() || 'email',
    message.getDate().getTime(),
    message.getId()
  );
}

/**
 * Builds the LEGACY filename older versions of this script would have used.
 */
function buildLegacyMessageFilename_(message) {
  return buildLegacyFilename_(
    message.getSubject() || 'email',
    message.getDate().getTime(),
    message.getId()
  );
}

/**
 * Returns true if the message already appears to be saved in the folder.
 * Checks both the current filename format and the legacy filename format.
 */
function messageAlreadySavedInFolder_(message, folder) {
  const candidateNames = uniqueNonEmptyStrings_([
    buildMessageFilename_(message),
    buildLegacyMessageFilename_(message)
  ]);

  for (let i = 0; i < candidateNames.length; i++) {
    if (folder.getFilesByName(candidateNames[i]).hasNext()) {
      return true;
    }
  }

  return false;
}

/**
 * Builds a safe filename for an attachment.
 */
function buildAttachmentFilename_(originalName, index) {
  const safe = sanitizeFilename_(originalName);
  if (safe) {
    return safe;
  }
  return 'attachment-' + pad2_(index);
}

/**
 * Sanitizes file names.
 */
function sanitizeFilename_(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|#%\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escapes text for simple card HTML display.
 */
function escapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Builds a simple safe HTML link for card text.
 */
function buildHtmlLink_(url, label, bold) {
  const safeUrl = String(url || '').trim();
  const safeLabel = escapeHtml_(label || '');

  if (!safeUrl) {
    return bold ? '<b>' + safeLabel + '</b>' : safeLabel;
  }

  const inner = bold ? '<b>' + safeLabel + '</b>' : safeLabel;
  return '<a href="' + safeUrl + '">' + inner + '</a>';
}

/**
 * Formats an ISO string for display.
 */
function formatIsoForDisplay_(isoText) {
  if (!isoText) return '';

  try {
    const d = new Date(isoText);
    if (isNaN(d.getTime())) return String(isoText);

    return Utilities.formatDate(
      d,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );
  } catch (err) {
    return String(isoText);
  }
}

/**
 * Builds a Drive URL for a folder.
 */
function buildDriveFolderUrl_(folderId) {
  const cleanId = String(folderId || '').trim();
  return cleanId
    ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(cleanId)
    : 'https://drive.google.com/';
}

/**
 * Shortens an ID for display.
 */
function shortId_(value) {
  const s = String(value || '');
  if (s.length <= 12) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}

/**
 * Pads a number to 2 digits.
 */
function pad2_(n) {
  return String(n).padStart(2, '0');
}

/**
 * Unique filter helper.
 */
function onlyUnique_(value, index, array) {
  return array.indexOf(value) === index;
}

/**
 * Returns unique non-empty strings.
 */
function uniqueNonEmptyStrings_(values) {
  const seen = {};
  const out = [];

  (values || []).forEach(value => {
    const s = String(value || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });

  return out;
}

/**
 * Merges two string arrays uniquely.
 */
function mergeUniqueStringArrays_(a, b) {
  return uniqueNonEmptyStrings_([].concat(a || [], b || []));
}
