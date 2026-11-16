/**
 * Observable.ts — the frame's NOTIFICATIONS (`BABYLON_EXIT.md` X6.1h):
 * Babylon 9.28's `Observable`, its `Observer` and its `EventState` PORTED as
 * written (`Misc/observable.pure.js`, every member), so an observer added,
 * added once, inserted first, removed — inside a notification or out of one —
 * or skipped by its mask behaves exactly as it did on Babylon's.
 * Owns: `Observable<T>`, `Observer<T>`, `EventState`, and the two interfaces
 * Babylon declared beside them (`IObserver`, `IReadonlyObservable`).
 * Invariants:
 * - **Every body is Babylon's, in its order** — what the frame's points
 *   (`SceneFrame`), the loop's (`FrameLoop`) and the glow's two
 *   (`GlowPass`) hang on, and what the frame adapter
 *   (`scripts/lib/frameAdapter.mjs`) and every probe rest on:
 *   - **notification order** is the list's: `add` pushes, `insertFirst`
 *     unshifts, `makeObserverTopPriority`/`BottomPriority` move one;
 *   - **removal is DEFERRED**: `remove` (and `removeCallback`) marks the
 *     observer `_willBeUnregistered` — so a notification in progress skips
 *     it from then on and `hasObservers` stops counting it — and splices it
 *     out of the list in a `setTimeout(0)` of its own, never during the
 *     walk; `Observer.remove(defer)` splices at once unless `defer`
 *     (Babylon's "can skip a callback" path); an `addOnce` observer is
 *     deferred the same way as it is called, before its callback runs;
 *   - **the mask**: an observer is called when `observer.mask & mask` is
 *     non-zero (both -1 by default), and `skipNextObservers` set by a
 *     callback ends the walk, `notifyObservers` answering false;
 *   - `notifyIfTriggered` replays the last value to an observer added after
 *     a notification; the `EventState` is ONE object per observable, reused
 *     by every notification (`_eventState`), as Babylon's was.
 * - A held observer keeps no strong reference to its observable: the removal
 *   closure goes through a `WeakRef`, as Babylon's did where one exists.
 * Never: allocates on a notification what Babylon's did not (the walk is the
 *   same `for…of` over the live array, the state reused) — the profiler's
 *   rule for a frame; catches a callback's throw (it propagates, as it did).
 * Contract: `docs/game.md` ("What a frame owes").
 *
 * ## Licence
 *
 * The class bodies are copied from Babylon.js 9.28 (`Misc/observable.pure.js`),
 * which is licensed under the Apache License, Version 2.0
 * (`node_modules/@babylonjs/core/license.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: the types
 * written into the bodies (Babylon's `.d.ts` beside its `.js`), and the
 * prototype extensions of `observable.extensions` (coroutines), which nothing
 * here runs, not ported.
 */

const IsWeakRefSupported = typeof WeakRef !== "undefined";

/**
 * A class serves as a medium between the observable and its observers
 */
export class EventState {
  /**
   * An Observer can set this property to true to prevent subsequent observers of being notified
   */
  skipNextObservers!: boolean;
  /**
   * Get the mask value that were used to trigger the event corresponding to this EventState object
   */
  mask!: number;
  /**
   * The object that originally notified the event
   */
  target?: any;
  /**
   * The current object in the bubbling phase
   */
  currentTarget?: any;
  /**
   * This will be populated with the return value of the last function that was executed.
   * If it is the first function in the callback chain it will be the event data.
   */
  lastReturnValue?: any;
  /**
   * User defined information that will be sent to observers
   */
  userInfo?: any;

  /**
   * Create a new EventState
   * @param mask defines the mask associated with this state
   * @param skipNextObservers defines a flag which will instruct the observable to skip following observers when set to true
   * @param target defines the original target of the state
   * @param currentTarget defines the current target of the state
   */
  constructor(mask: number, skipNextObservers = false, target?: any, currentTarget?: any) {
    this.initialize(mask, skipNextObservers, target, currentTarget);
  }

  /**
   * Initialize the current event state
   * @param mask defines the mask associated with this state
   * @param skipNextObservers defines a flag which will instruct the observable to skip following observers when set to true
   * @param target defines the original target of the state
   * @param currentTarget defines the current target of the state
   * @returns the current event state
   */
  initialize(mask: number, skipNextObservers = false, target?: any, currentTarget?: any): EventState {
    this.mask = mask;
    this.skipNextObservers = skipNextObservers;
    this.target = target;
    this.currentTarget = currentTarget;
    return this;
  }
}

/**
 * An interface that defines an observer, which can be removed from its observable.
 */
export interface IObserver {
  /**
   * Remove the observer from its observable.
   * @param defer if true, the removal will be deferred to avoid callback skipping (default: false)
   */
  remove(defer?: boolean): void;
}

/**
 * Represent an observer registered to a given Observable object.
 */
export class Observer<T> implements IObserver {
  /** @internal */
  _willBeUnregistered = false;
  /**
   * Gets or sets a property defining that the observer as to be unregistered after the next notification
   */
  unregisterOnNextCall = false;
  /**
   * this function can be used to remove the observer from the observable.
   * It will be set by the observable that the observer belongs to.
   * @internal
   */
  _remove: ((defer?: boolean) => void) | null = null;

  /**
   * Creates a new observer
   * @param callback defines the callback to call when the observer is notified
   * @param mask defines the mask of the observer (used to filter notifications)
   * @param scope defines the current scope used to restore the JS context
   */
  constructor(
    /**
     * Defines the callback to call when the observer is notified
     */
    public callback: (eventData: T, eventState: EventState) => void,
    /**
     * Defines the mask of the observer (used to filter notifications)
     */
    public mask: number,
    /**
     * [null] Defines the current scope used to restore the JS context
     */
    public scope: any = null,
  ) {}

  /**
   * Remove the observer from its observable
   * This can be used instead of using the observable's remove function.
   * @param defer if true, the removal will be deferred to avoid callback skipping (default: false)
   */
  remove(defer = false): void {
    if (this._remove) {
      this._remove(defer);
    }
  }
}

/**
 * An Observable that can be subscribed to, but not notified.
 */
export interface IReadonlyObservable<T = unknown> {
  /**
   * Create a new Observer with the specified callback
   * @param callback the callback that will be executed for that Observer
   * @param mask the mask used to filter observers
   * @param insertFirst if true the callback will be inserted at the first position, hence executed before the others ones. If false (default behavior) the callback will be inserted at the last position, executed after all the others already present.
   * @param scope optional scope for the callback to be called from
   * @param unregisterOnFirstCall defines if the observer as to be unregistered after the next notification
   * @returns the new observer created for the callback
   */
  add(
    callback: (eventData: T, eventState: EventState) => void,
    mask?: number,
    insertFirst?: boolean,
    scope?: unknown,
    unregisterOnFirstCall?: boolean,
  ): IObserver;
  /**
   * Create a new Observer with the specified callback and unregisters after the next notification.
   * @param callback the callback that will be executed for that Observer
   * @returns the new observer created for the callback
   */
  addOnce(callback: (eventData: T, eventState: EventState) => void): IObserver;
}

/**
 * The Observable class is a simple implementation of the Observable pattern.
 *
 * There's one slight particularity though: a given Observable can notify its observer using a particular mask value, only the Observers registered with this mask value will be notified.
 * This enable a more fine grained execution without having to rely on multiple different Observable objects.
 * For instance you may have a given Observable that have four different types of notifications: Move (mask = 0x01), Stop (mask = 0x02), Turn Right (mask = 0X04), Turn Left (mask = 0X08).
 * A given observer can register itself with only Move and Stop (mask = 0x03), then it will only be notified when one of these two occurs and will never be for Turn Left/Right.
 */
export class Observable<T> implements IReadonlyObservable<T> {
  private _observers = new Array<Observer<T>>();
  private _numObserversMarkedAsDeleted = 0;
  private _hasNotified = false;
  private _lastNotifiedValue?: T;
  /**
   * @internal
   */
  _eventState: EventState = new EventState(0);
  private _onObserverAdded?: ((observer: Observer<T>) => void) | null;

  /**
   * Create an observable from a Promise.
   * @param promise a promise to observe for fulfillment.
   * @param onErrorObservable an observable to notify if a promise was rejected.
   * @returns the new Observable
   */
  static FromPromise<T, E = Error>(promise: Promise<T>, onErrorObservable?: Observable<E>): Observable<T> {
    const observable = new Observable<T>();
    promise
      // eslint-disable-next-line github/no-then
      .then((ret: T) => {
        observable.notifyObservers(ret);
      })
      // eslint-disable-next-line github/no-then
      .catch((err) => {
        if (onErrorObservable) {
          onErrorObservable.notifyObservers(err as E);
        } else {
          throw err;
        }
      });
    return observable;
  }

  /**
   * Gets the list of observers
   * Note that observers that were recently deleted may still be present in the list because they are only really deleted on the next javascript tick!
   */
  get observers(): Array<Observer<T>> {
    return this._observers;
  }

  /**
   * Creates a new observable
   * @param onObserverAdded defines a callback to call when a new observer is added
   * @param notifyIfTriggered If set to true the observable will notify when an observer was added if the observable was already triggered.
   */
  constructor(
    onObserverAdded?: (observer: Observer<T>) => void,
    /**
     * [false] If set to true the observable will notify when an observer was added if the observable was already triggered.
     * This is helpful to single-state observables like the scene onReady or the dispose observable.
     */
    public notifyIfTriggered = false,
  ) {
    if (onObserverAdded) {
      this._onObserverAdded = onObserverAdded;
    }
  }

  /**
   * Create a new Observer with the specified callback
   * @param callback the callback that will be executed for that Observer
   * @param mask the mask used to filter observers
   * @param insertFirst if true the callback will be inserted at the first position, hence executed before the others ones. If false (default behavior) the callback will be inserted at the last position, executed after all the others already present.
   * @param scope optional scope for the callback to be called from
   * @param unregisterOnFirstCall defines if the observer as to be unregistered after the next notification
   * @returns the new observer created for the callback
   */
  add(callback?: null, mask?: number, insertFirst?: boolean, scope?: any, unregisterOnFirstCall?: boolean): null;
  add(
    callback: (eventData: T, eventState: EventState) => void,
    mask?: number,
    insertFirst?: boolean,
    scope?: any,
    unregisterOnFirstCall?: boolean,
  ): Observer<T>;
  add(
    callback?: ((eventData: T, eventState: EventState) => void) | null,
    mask?: number,
    insertFirst?: boolean,
    scope?: any,
    unregisterOnFirstCall?: boolean,
  ): Observer<T> | null;
  add(
    callback?: ((eventData: T, eventState: EventState) => void) | null,
    mask: number = -1,
    insertFirst = false,
    scope: any = null,
    unregisterOnFirstCall = false,
  ): Observer<T> | null {
    if (!callback) {
      return null;
    }

    const observer = new Observer(callback, mask, scope);
    observer.unregisterOnNextCall = unregisterOnFirstCall;

    if (insertFirst) {
      this._observers.unshift(observer);
    } else {
      this._observers.push(observer);
    }

    if (this._onObserverAdded) {
      this._onObserverAdded(observer);
    }

    // If the observable was already triggered and the observable is set to notify if triggered, notify the new observer
    if (this._hasNotified && this.notifyIfTriggered) {
      this.notifyObserver(observer, this._lastNotifiedValue as T);
    }

    // attach the remove function to the observer
    const observableWeakRef = IsWeakRefSupported ? new WeakRef(this) : { deref: () => this };
    observer._remove = (defer = false) => {
      const observable = observableWeakRef.deref();
      if (observable) {
        defer ? observable.remove(observer) : observable._remove(observer);
      }
    };

    return observer;
  }

  /**
   * Create a new Observer with the specified callback and unregisters after the next notification.
   * @param callback the callback that will be executed for that Observer
   * @returns the new observer created for the callback
   */
  addOnce(callback?: null): null;
  addOnce(callback: (eventData: T, eventState: EventState) => void): Observer<T>;
  addOnce(callback?: ((eventData: T, eventState: EventState) => void) | null): Observer<T> | null;
  addOnce(callback?: ((eventData: T, eventState: EventState) => void) | null): Observer<T> | null {
    return this.add(callback, undefined, undefined, undefined, true);
  }

  /**
   * Remove an Observer from the Observable object
   * @param observer the instance of the Observer to remove
   * @returns false if it doesn't belong to this Observable
   */
  remove(observer: Observer<T> | null): boolean {
    if (!observer) {
      return false;
    }

    observer._remove = null;
    const index = this._observers.indexOf(observer);

    if (index !== -1) {
      this._deferUnregister(observer);
      return true;
    }

    return false;
  }

  /**
   * Remove a callback from the Observable object
   * @param callback the callback to remove
   * @param scope optional scope. If used only the callbacks with this scope will be removed
   * @returns false if it doesn't belong to this Observable
   */
  removeCallback(callback: (eventData: T, eventState: EventState) => void, scope?: any): boolean {
    for (let index = 0; index < this._observers.length; index++) {
      const observer = this._observers[index];
      if (observer._willBeUnregistered) {
        continue;
      }
      if (observer.callback === callback && (!scope || scope === observer.scope)) {
        this._deferUnregister(observer);
        return true;
      }
    }

    return false;
  }

  /**
   * @internal
   */
  _deferUnregister(observer: Observer<T>): void {
    if (observer._willBeUnregistered) {
      return;
    }
    this._numObserversMarkedAsDeleted++;
    observer.unregisterOnNextCall = false;
    observer._willBeUnregistered = true;
    setTimeout(() => {
      this._remove(observer);
    }, 0);
  }

  // This should only be called when not iterating over _observers to avoid callback skipping.
  // Removes an observer from the _observer Array.
  private _remove(observer: Observer<T> | null, updateCounter = true): boolean {
    if (!observer) {
      return false;
    }

    const index = this._observers.indexOf(observer);

    if (index !== -1) {
      if (updateCounter) {
        this._numObserversMarkedAsDeleted--;
      }
      this._observers.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Moves the observable to the top of the observer list making it get called first when notified
   * @param observer the observer to move
   */
  makeObserverTopPriority(observer: Observer<T>): void {
    this._remove(observer, false);
    this._observers.unshift(observer);
  }

  /**
   * Moves the observable to the bottom of the observer list making it get called last when notified
   * @param observer the observer to move
   */
  makeObserverBottomPriority(observer: Observer<T>): void {
    this._remove(observer, false);
    this._observers.push(observer);
  }

  /**
   * Notify all Observers by calling their respective callback with the given data
   * Will return true if all observers were executed, false if an observer set skipNextObservers to true, then prevent the subsequent ones to execute
   * @param eventData defines the data to send to all observers
   * @param mask defines the mask of the current notification (observers with incompatible mask (ie mask & observer.mask === 0) will not be notified)
   * @param target defines the original target of the state
   * @param currentTarget defines the current target of the state
   * @param userInfo defines any user info to send to observers
   * @returns false if the complete observer chain was not processed (because one observer set the skipNextObservers to true)
   */
  notifyObservers(eventData: T, mask: number = -1, target?: any, currentTarget?: any, userInfo?: any): boolean {
    // this prevents potential memory leaks - if an object is disposed but the observable doesn't get cleared.
    if (this.notifyIfTriggered) {
      this._hasNotified = true;
      this._lastNotifiedValue = eventData;
    }
    if (!this._observers.length) {
      return true;
    }

    const state = this._eventState;
    state.mask = mask;
    state.target = target;
    state.currentTarget = currentTarget;
    state.skipNextObservers = false;
    state.lastReturnValue = eventData;
    state.userInfo = userInfo;

    for (const obs of this._observers) {
      if (obs._willBeUnregistered) {
        continue;
      }

      if (obs.mask & mask) {
        if (obs.unregisterOnNextCall) {
          this._deferUnregister(obs);
        }

        if (obs.scope) {
          state.lastReturnValue = (obs.callback as (...args: unknown[]) => unknown).apply(obs.scope, [eventData, state]);
        } else {
          state.lastReturnValue = (obs.callback as (eventData: T, eventState: EventState) => unknown)(eventData, state);
        }
      }
      if (state.skipNextObservers) {
        return false;
      }
    }
    return true;
  }

  /**
   * Notify a specific observer
   * @param observer defines the observer to notify
   * @param eventData defines the data to be sent to each callback
   * @param mask is used to filter observers defaults to -1
   */
  notifyObserver(observer: Observer<T>, eventData: T, mask: number = -1): void {
    // this prevents potential memory leaks - if an object is disposed but the observable doesn't get cleared.
    if (this.notifyIfTriggered) {
      this._hasNotified = true;
      this._lastNotifiedValue = eventData;
    }

    if (observer._willBeUnregistered) {
      return;
    }

    const state = this._eventState;
    state.mask = mask;
    state.skipNextObservers = false;

    if (observer.unregisterOnNextCall) {
      this._deferUnregister(observer);
    }

    observer.callback(eventData, state);
  }

  /**
   * Gets a boolean indicating if the observable has at least one observer
   * @returns true is the Observable has at least one Observer registered
   */
  hasObservers(): boolean {
    return this._observers.length - this._numObserversMarkedAsDeleted > 0;
  }

  /**
   * Clear the list of observers
   */
  clear(): void {
    while (this._observers.length) {
      const o = this._observers.pop();
      if (o) {
        o._remove = null;
      }
    }
    this._onObserverAdded = null;
    this._numObserversMarkedAsDeleted = 0;
    this.cleanLastNotifiedState();
  }

  /**
   * Clean the last notified state - both the internal last value and the has-notified flag
   */
  cleanLastNotifiedState(): void {
    this._hasNotified = false;
    this._lastNotifiedValue = undefined;
  }

  /**
   * Clone the current observable
   * @returns a new observable
   */
  clone(): Observable<T> {
    const result = new Observable<T>();

    result._observers = this._observers.slice(0);

    return result;
  }

  /**
   * Does this observable handles observer registered with a given mask
   * @param mask defines the mask to be tested
   * @returns whether or not one observer registered with the given mask is handled
   **/
  hasSpecificMask(mask: number = -1): boolean {
    for (const obs of this._observers) {
      if (obs.mask & mask || obs.mask === mask) {
        return true;
      }
    }
    return false;
  }
}
