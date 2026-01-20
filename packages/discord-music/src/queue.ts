import type { Track } from "./types";

export class Queue {
  private tracks: Track[] = [];

  add(track: Track): void {
    this.tracks.push(track);
  }

  addMany(tracks: Track[]): void {
    this.tracks.push(...tracks);
  }

  remove(index: number): Track | undefined {
    return this.tracks.splice(index, 1)[0];
  }

  clear(): void {
    this.tracks = [];
  }

  shuffle(): void {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }

  next(): Track | undefined {
    return this.tracks.shift();
  }

  peek(): Track | undefined {
    return this.tracks[0];
  }

  getAll(): Track[] {
    return [...this.tracks];
  }

  get length(): number {
    return this.tracks.length;
  }

  get isEmpty(): boolean {
    return this.tracks.length === 0;
  }
}
