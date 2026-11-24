import { Object3D } from './Object3D';

export class Group extends Object3D {
  readonly isGroup = true;

  constructor() {
    super();
    this.type = 'Group';
  }
}
