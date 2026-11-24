export class WebGLProperties {
  private properties = new WeakMap<object, Record<string, unknown>>();

  has(object: object): boolean {
    return this.properties.has(object);
  }

  get<T extends object = Record<string, unknown>>(object: object): T {
    let map = this.properties.get(object);
    if (map === undefined) {
      map = {};
      this.properties.set(object, map);
    }
    return map as unknown as T;
  }

  remove(object: object): void {
    this.properties.delete(object);
  }

  update(object: object, key: string, value: unknown): void {
    const map = this.get(object);
    map[key] = value;
  }

  dispose(): void {
    this.properties = new WeakMap<object, Record<string, unknown>>();
  }
}
