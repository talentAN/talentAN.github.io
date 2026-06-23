import { higherLows } from './higherLows';
import { notAtHighs } from './notAtHighs';
import { lowVolume } from './lowVolume';
import { minLowGap } from './minLowGap';

/**
 * FILTERS — 所有筛选条件的元数据 + 纯函数引用
 * 新增条件：在此数组里追加一项，并在对应文件里实现逻辑即可。
 */
export const FILTERS = [
  {
    id: 'f1',
    label: '连续3个更高低点',
    desc: '3 个 swing low 依次抬升；最近低点 ≤ 10 天前；最远低点为其前 20 天最低价',
    fn: higherLows,
  },
  {
    id: 'f2',
    label: '未在历史高位',
    desc: '当前价 < 历史最高价 × 70%',
    fn: notAtHighs,
  },
  {
    id: 'f3',
    label: '近期成交量偏低',
    desc: '近 15 日均量 ≤ 历史均量',
    fn: lowVolume,
  },
  {
    id: 'f4',
    label: '低点间隔 ≥ 5 天',
    desc: '3 个低点中，相邻两个低点之间的间隔均 ≥ 5 根 K 线（依赖条件1）',
    fn: minLowGap,
  },
];
