import { it, expect, vi } from 'vitest';
import { RelationsWidget } from '../src/features/code/CodeReader';
it('preserves an unchanged lens across detached state hydration',()=>{
 const one=new RelationsWidget('1 found · partial','Spend',vi.fn());
 const two=new RelationsWidget('1 found · partial','Spend',vi.fn());
 expect(one.eq(two)).toBe(true);
 expect(one.eq(new RelationsWidget('2 found · partial','Spend',vi.fn()))).toBe(false);
});
