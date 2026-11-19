// @ts-nocheck -- vendored from @lume/kiwi 0.4.4 (BSD-3-Clause, see COPYING.txt); only maptype.ts is changed.
export interface IMap<T extends {id(): number}, U> extends IndexedMap<T, U> {}

export function createMap<T extends {id(): number}, U>(): IMap<T, U> {
	return new IndexedMap<T, U>()
}

/**
 * A map kept sorted by key id, as C++ Kiwi's Loki::AssocVector is sorted by symbol: the solver iterates rows and
 * cells in this order to pick pivots, so the order decides which of several equally good solutions it ends on. (The
 * upstream @lume/kiwi keeps insertion order instead, which solves the same problems but breaks ties differently from
 * the C++ Kiwi the NWN client and kiwisolver use; nwn-nui-designer changed it to match them.)
 */
class IndexedMap<T extends {id(): number}, U> {
	public array = [] as Array<Pair<T, U>>

	/** The index of key's pair, or -(insertion point) - 1. */
	private search(id: number): number {
		let lo = 0
		let hi = this.array.length - 1
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1
			const m = this.array[mid].first.id()
			if (m < id) lo = mid + 1
			else if (m > id) hi = mid - 1
			else return mid
		}
		return -lo - 1
	}

	/**
	 * Returns the number of items in the array.
	 */
	public size(): number {
		return this.array.length
	}

	/**
	 * Returns true if the array is empty.
	 */
	public empty(): boolean {
		return this.array.length === 0
	}

	/**
	 * Returns the item at the given array index.
	 *
	 * @param index The integer index of the desired item.
	 */
	public itemAt(index: number): Pair<T, U> {
		return this.array[index]
	}

	/**
	 * Returns true if the key is in the array, false otherwise.
	 *
	 * @param key The key to locate in the array.
	 */
	public contains(key: T) {
		return this.search(key.id()) >= 0
	}

	/**
	 * Returns the pair associated with the given key, or undefined.
	 *
	 * @param key The key to locate in the array.
	 */
	public find(key: T) {
		const i = this.search(key.id())
		return i >= 0 ? this.array[i] : undefined
	}

	/**
	 * Returns the pair associated with the key if it exists.
	 *
	 * If the key does not exist, a new pair will be created and
	 * inserted using the value created by the given factory.
	 *
	 * @param key The key to locate in the array.
	 * @param factory The function which creates the default value.
	 */
	public setDefault(key: T, factory: () => U): Pair<T, U> {
		const i = this.search(key.id())
		if (i >= 0) return this.array[i]
		const pair = new Pair(key, factory())
		this.array.splice(-i - 1, 0, pair)
		return pair
	}

	/**
	 * Insert the pair into the array and return the pair.
	 *
	 * This will overwrite any existing entry in the array.
	 *
	 * @param key The key portion of the pair.
	 * @param value The value portion of the pair.
	 */
	public insert(key: T, value: U): Pair<T, U> {
		const pair = new Pair(key, value)
		const i = this.search(key.id())
		if (i >= 0) this.array[i] = pair
		else this.array.splice(-i - 1, 0, pair)
		return pair
	}

	/**
	 * Removes and returns the pair for the given key, or undefined.
	 *
	 * @param key The key to remove from the map.
	 */
	public erase(key: T): Pair<T, U> {
		const i = this.search(key.id())
		if (i < 0) return undefined
		return this.array.splice(i, 1)[0]
	}

	/**
	 * Create a copy of this associative array.
	 */
	public copy(): IndexedMap<T, U> {
		const copy = new IndexedMap<T, U>()
		for (let i = 0; i < this.array.length; i++) copy.array[i] = this.array[i].copy()
		return copy
	}
}

/**
 * A class which defines a generic pair object.
 * @private
 */
// tslint:disable: max-classes-per-file
class Pair<T, U> {
	/**
	 * Construct a new Pair object.
	 *
	 * @param first The first item of the pair.
	 * @param second The second item of the pair.
	 */
	constructor(
		public first: T,
		public second: U,
	) {}

	/**
	 * Create a copy of the pair.
	 */
	public copy() {
		return new Pair(this.first, this.second)
	}
}
