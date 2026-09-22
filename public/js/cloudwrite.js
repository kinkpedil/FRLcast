/*
 * Turning the console's action vocabulary into database writes.
 *
 * The socket bus took an action name and a patch and let the server work out what that
 * meant. Here the meaning has to be spelled out per action, because a write goes to a
 * specific table and is checked against a specific policy.
 *
 * Only the actions that have actually been ported are here. The rest throw rather than
 * quietly doing nothing: an operator pressing a button that silently fails during a race
 * is worse than one that says it is not wired up yet.
 */

const SETTINGS_ACTIONS = new Set([
  'overlay.update', 'overlay.layout', 'overlay.scene',
  'drift.update', 'calibration.update', 'championship.update', 'rules.update'
]);

/** Merge a patch into one branch of the settings blob, without reading the whole event. */
async function patchSettings(sb, event, branch, patch) {
  const current = event.settings || {};
  const next = { ...current, [branch]: { ...(current[branch] || {}), ...patch } };
  const { error } = await sb.from('events').update({ settings: next }).eq('id', event.id);
  if (error) throw error;
  // Kept locally too so a second write in the same tick builds on the first rather than
  // on whatever the last Realtime message happened to carry.
  event.settings = next;
}

export async function writeAction(sb, event, type, extra) {
  switch (type) {
    case 'overlay.update':
      return patchSettings(sb, event, 'overlay', extra.patch || {});

    case 'overlay.layout': {
      // One widget's placement. Nested a level deeper than the rest of the overlay
      // settings, so it gets its own read and merge rather than going through the helper.
      const current = event.settings || {};
      const overlay = { ...(current.overlay || {}) };
      const layout = { ...(overlay.layout || {}) };
      layout[extra.id] = { ...(layout[extra.id] || {}), ...(extra.patch || {}) };
      overlay.layout = layout;
      const next = { ...current, overlay };
      const { error } = await sb.from('events').update({ settings: next }).eq('id', event.id);
      if (error) throw error;
      event.settings = next;
      return;
    }

    case 'race.flag': {
      const { error } = await sb.from('events')
        .update({ status: extra.flag, flag_source: 'operator' }).eq('id', event.id);
      if (error) throw error;
      return;
    }

    default:
      if (SETTINGS_ACTIONS.has(type)) {
        return patchSettings(sb, event, type.split('.')[0], extra.patch || {});
      }
      throw new Error(`"${type}" has not been moved to the hosted event yet`);
  }
}
