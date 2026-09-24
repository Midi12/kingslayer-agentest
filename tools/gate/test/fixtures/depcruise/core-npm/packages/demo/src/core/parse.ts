import { Type } from '@sinclair/typebox';
import { parse } from 'yaml';

export const Schema = Type.String();

export function load(text: string): unknown {
  return parse(text);
}
