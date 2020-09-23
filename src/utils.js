import path from 'path';
import fs from 'fs';
import dotProp from 'dot-prop';
import log from './logger';


export function keywordReplace(input, mappings) {
  // Replace keywords with mappings within input.
  if (mappings && Object.keys(mappings).length > 0) {
    Object.keys(mappings).forEach(function(key) {
      const re = new RegExp(`##${key}##`, 'g');
      input = input.replace(re, mappings[key]);
    });

    Object.keys(mappings).forEach(function(key) {
      const re = new RegExp(`@@${key}@@`, 'g');
      input = input.replace(re, JSON.stringify(mappings[key]));
    });
  }
  return input;
}

export function convertClientNameToId(name, clients) {
  const found = clients.find(c => c.name === name);
  return (found && found.client_id) || name;
}

export function convertClientNamesToIds(names, clients) {
  const resolvedNames = names.map(name => ({ name, resolved: false }));
  const result = clients.reduce((acc, client) => {
    if (names.includes(client.name)) {
      const index = resolvedNames.findIndex(item => item.name === client.name);
      resolvedNames[index].resolved = true;
      acc.push(client.client_id);
    }
    return acc;
  }, []);
  const unresolved = resolvedNames.filter(item => !item.resolved).map(item => item.name);
  return [ ...unresolved, ...result ];
}

export function loadFile(file, mappings) {
  // Load file and replace keyword mappings
  const f = path.resolve(file);
  try {
    fs.accessSync(f, fs.F_OK);
    if (mappings) {
      return keywordReplace(fs.readFileSync(f, 'utf8'), mappings);
    }
    return fs.readFileSync(f, 'utf8');
  } catch (error) {
    throw new Error(`Unable to load file ${f} due to ${error}`);
  }
}

export function flatten(list) {
  // Flatten an multiple arrays to single array
  return list.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);
}

export function dumpJSON(obj, spacing = 0) {
  return JSON.stringify(obj, null, spacing);
}


export function calcChanges(assets, existing, identifiers = [ 'id', 'name' ]) {
  // Calculate the changes required between two sets of assets.
  const update = [];
  let del = [ ...existing ];
  let create = [ ...assets ];
  const conflicts = [];

  const findByKeyValue = (key, value, arr) => arr.find((e) => {
    if (Array.isArray(key)) {
      const values = key.map(k => e[k]);
      if (values.every(v => v)) {
        return value === values.join('-');
      }
    } else {
      return e[key] === value;
    }
    return false;
  });

  const processAssets = (id, arr) => {
    arr.forEach((asset) => {
      let assetIdValue;
      if (Array.isArray(id)) {
        const values = id.map(i => asset[i]);
        if (values.every(v => v)) {
          assetIdValue = values.join('-');
        }
      } else {
        assetIdValue = asset[id];
      }

      if (assetIdValue) {
        const found = findByKeyValue(id, assetIdValue, del);
        if (found) {
          // Delete from existing
          del = del.filter(e => e !== found);

          // Delete from create as it's an update
          create = create.filter(e => e !== asset);

          // Append identifiers to asset
          update.push({
            ...identifiers.reduce((obj, i) => {
              if (found[i]) obj[i] = found[i];
              return obj;
            }, {}),
            ...asset
          });
        }
      }
    });
  };

  // Loop through identifiers (in order) to try match assets to existing
  // If existing then update if not create
  // The remainder will be deleted
  for (const id of identifiers) { // eslint-disable-line
    processAssets(id, [ ...create ]);
  }

  // Check if there are assets with names that will conflict with existing names during the update process
  // This will rename those assets to a temp random name first
  // This assumes the first identifiers is the unique identifier
  if (identifiers.includes('name')) {
    const uniqueID = identifiers[0];
    const futureAssets = [ ...create, ...update ];
    futureAssets.forEach((a) => {
      // If the conflicting item is going to be deleted then skip
      const inDeleted = del.filter(e => e.name === a.name && e[uniqueID] !== a[uniqueID])[0];
      if (!inDeleted) {
        const conflict = existing.filter(e => e.name === a.name && e[uniqueID] !== a[uniqueID])[0];
        if (conflict) {
          const temp = Math.random().toString(36).substr(2, 5);
          conflicts.push({
            ...conflict,
            name: `${conflict.name}-${temp}`
          });
        }
      }
    });
  }


  return {
    del,
    update,
    conflicts,
    create
  };
}

export function stripFields(obj, fields) {
  // Strip object fields supporting dot notation (ie: a.deep.field)
  const stripped = [];

  const newObj = { ...obj };
  fields.forEach((f) => {
    if (dotProp.get(newObj, f) !== undefined) {
      dotProp.delete(newObj, f);
      stripped.push(f);
    }
  });

  if (stripped) {
    const name = [ 'id', 'client_id', 'template', 'name' ].reduce((n, k) => newObj[k] || n, '');
    log.debug(`Stripping "${name}" read-only fields ${JSON.stringify(stripped)}`);
  }
  return newObj;
}

export function getEnabledClients(assets, connection, existing, clients) {
  // Convert enabled_clients by name to the id
  const excludedClientsByNames = (assets.exclude && assets.exclude.clients) || [];
  const excludedClients = convertClientNamesToIds(excludedClientsByNames, clients);
  const enabledClients = [
    ...convertClientNamesToIds(
      connection.enabled_clients || [],
      clients
    ).filter(
      item => ![ ...excludedClientsByNames, ...excludedClients ].includes(item)
    )
  ];
  // If client is excluded and in the existing connection this client is enabled, it should keep enabled
  // If client is excluded and in the existing connection this client is disabled, it should keep disabled
  existing.forEach((conn) => {
    if (conn.name === connection.name) {
      excludedClients.forEach((excludedClient) => {
        if (conn.enabled_clients.includes(excludedClient)) {
          enabledClients.push(excludedClient);
        }
      });
    }
  });
  return enabledClients;
}

export function duplicateItems(arr, key) {
  // Find duplicates objects within array that have the same key value
  const duplicates = arr.reduce((accum, obj) => {
    const keyValue = obj[key];
    if (keyValue) {
      if (!(keyValue in accum)) accum[keyValue] = [];
      accum[keyValue].push(obj);
    }
    return accum;
  }, {});
  return Object.values(duplicates).filter(g => g.length > 1);
}


export function filterExcluded(changes, exclude) {
  const {
    del, update, create, conflicts
  } = changes;

  if (!exclude.length) {
    return changes;
  }

  const filter = list => list.filter(item => !exclude.includes(item.name));

  return {
    del: filter(del),
    update: filter(update),
    create: filter(create),
    conflicts: filter(conflicts)
  };
}
