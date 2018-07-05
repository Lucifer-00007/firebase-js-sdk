/**
 * Copyright 2018 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { firestore } from 'firebase/app';
import { fromCollectionRef } from '../fromRef';
import { Observable } from 'rxjs';
import { map, filter, scan } from 'rxjs/operators';

const ALL_EVENTS: firestore.DocumentChangeType[] = [
  'added',
  'modified',
  'removed'
];

/**
 * Create an operator that determines if a the stream of document changes
 * are specified by the event filter. If the document change type is not
 * in specified events array, it will not be emitted.
 */
const filterEvents = (events?: firestore.DocumentChangeType[]) =>
  filter((changes: firestore.DocumentChange[]) => {
    let hasChange = false;
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (events.indexOf(change.type) >= 0) {
        hasChange = true;
        break;
      }
    }
    return hasChange;
  });

/**
 * Create an operator that filters out empty changes. We provide the
 * ability to filter on events, which means all changes can be filtered out.
 * This creates an empty array and would be incorrect to emit.
 */
const filterEmpty = filter(
  (changes: firestore.DocumentChange[]) => changes.length > 0
);

/**
 * Creates a new sorted array from a new change.
 * @param combined
 * @param change
 */
function processIndividualChange(
  combined: firestore.DocumentChange[],
  change: firestore.DocumentChange
): firestore.DocumentChange[] {
  switch (change.type) {
    case 'added':
      if (
        combined[change.newIndex] &&
        combined[change.newIndex].doc.id == change.doc.id
      ) {
        // Skip duplicate emissions. This is rare.
        // TODO: Investigate possible bug in SDK.
      } else {
        combined.splice(change.newIndex, 0, change);
      }
      break;
    case 'modified':
      // When an item changes position we first remove it
      // and then add it's new position
      if (change.oldIndex !== change.newIndex) {
        combined.splice(change.oldIndex, 1);
        combined.splice(change.newIndex, 0, change);
      } else {
        combined[change.newIndex] = change;
      }
      break;
    case 'removed':
      combined.splice(change.oldIndex, 1);
      break;
  }
  return combined;
}

/**
 * Combines the total result set from the current set of changes from an incoming set
 * of changes.
 * @param current
 * @param changes
 * @param events
 */
function processDocumentChanges(
  current: firestore.DocumentChange[],
  changes: firestore.DocumentChange[],
  events: firestore.DocumentChangeType[] = ALL_EVENTS
) {
  changes.forEach(change => {
    // skip unwanted change types
    if (events.indexOf(change.type) > -1) {
      current = processIndividualChange(current, change);
    }
  });
  return current;
}

/**
 * Return a stream of document changes on a query. These results are not in sort order but in
 * order of occurence.
 * @param query
 */
export function docChanges(
  query: firestore.Query,
  events: firestore.DocumentChangeType[] = ALL_EVENTS
) {
  return fromCollectionRef(query).pipe(
    map(snapshot => snapshot.docChanges()),
    filterEvents(events),
    filterEmpty
  );
}

/**
 * Return a stream of document snapshots on a query. These results are in sort order.
 * @param query
 */
export function collection(query: firestore.Query) {
  return fromCollectionRef(query).pipe(map(changes => changes.docs));
}

/**
 * Return a stream of document changes on a query. These results are in sort order.
 * @param query
 */
export function sortedChanges(
  query: firestore.Query,
  events?: firestore.DocumentChangeType[]
) {
  return docChanges(query, events).pipe(
    scan(
      (
        current: firestore.DocumentChange[],
        changes: firestore.DocumentChange[]
      ) => processDocumentChanges(current, changes, events),
      []
    )
  );
}

/**
 * Create a stream of changes as they occur it time. This method is similar
 * to docChanges() but it collects each event in an array over time.
 */
export function auditTrail(
  query: firestore.Query,
  events?: firestore.DocumentChangeType[]
): Observable<firestore.DocumentChange[]> {
  return docChanges(query, events).pipe(
    scan((current, action) => [...current, ...action], [])
  );
}

/**
 * Maps a collection or document of snapshot to the data payload and
 * optionally maps the metadata and/or the doc ID to a specified key
 * @property {string} id the key to map the doc id to
 */

export function unwrap(id?: string) {
  // Observable map
  return map(
    (
      snap: firestore.QueryDocumentSnapshot | firestore.QueryDocumentSnapshot[]
    ) => {
      if (snap instanceof Array) {
        // Array map
        return snap.map(doc => snapToData(doc, id));
      } else {
        // Object map
        return snapToData(snap, id);
      }
    }
  );
}

function snapToData<T>(doc: firestore.QueryDocumentSnapshot, id?: string) {
  return {
    ...doc.data(),
    ...(id ? { [id]: doc.id } : null)
  };
}
