import React from 'react';
import { Popover } from 'antd';
import moment from 'moment';
import { scaleLinear } from 'd3-scale';
import style from './index.module.less';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Des'];

// 获取开始日期
const _getStartDate = () => {
  const lastToday = moment().subtract(1, 'year');
  const weekNum = lastToday.day();
  return lastToday.subtract(weekNum, 'days').format('YYYYMMDD');
};
// 获取结束日期
const _getEndDate = () => {
  const weekNum = moment().day();
  return moment().subtract(weekNum, 'days').format('YYYYMMDD');
};
// 获取所有组
const _getAllDate = startSunday => {
  let current = moment(startSunday);
  const entDate = _getEndDate() * 1;
  const ret = [];
  while (current.format('YYYYMMDD') * 1 <= entDate) {
    ret.push(current.format('YYYYMMDD'));
    current = current.add(7, 'days');
  }
  return ret;
};
//获取每组日期
const _genWeekGroup = startSunday => {
  const ret = [];
  const today = moment().day();
  const isFullWeek = startSunday * 1 < moment().format('YYYYMMDD') * 1 - 6;
  const count = isFullWeek ? 7 : today;
  for (let i = 0; i < count; i++) {
    ret.push(moment(startSunday).add(i, 'days').format('YYYYMMDD'));
  }
  return ret;
};
// 获取各种派生数据
const _getExtends = data => {
  let min = Infinity;
  let max = 0;
  let total = 0;
  Object.values(data).forEach(val => {
    total += val;
    min = Math.min(min, val);
    max = Math.max(max, val);
  });
  return {
    min,
    max,
    total,
  };
};
// 颜色比例尺
const _colorGenerator = (min, max) => {
  return scaleLinear().domain([min, max]).range(['#ebedf0', '#304cfd']);
};
// 判断显示月份
const _getShowMonth = (startSunday, isFirstColumn = false) => {
  const month = moment(startSunday).month();
  let shouldShow = false;
  const next7Day = moment(startSunday).add(7, 'days');
  if (isFirstColumn) {
    shouldShow = next7Day.month() === month;
    return shouldShow ? MONTH[month] : null;
  }
  const pre7Day = moment(startSunday).subtract(7, 'days');
  shouldShow = pre7Day.month() !== month && next7Day.month() === month;
  return shouldShow ? MONTH[month] : null;
};

const HeatChart = props => {
  const { data } = props;
  const startSunday = _getStartDate();
  const allDates = _getAllDate(startSunday);
  const { min, max } = _getExtends(data);
  const colorCalculator = _colorGenerator(min, max);

  return (
    <div className={style.root}>
      <div className={style.wrapper}>
        <svg width={722} height={112}>
          <g transform="translate(10, 20)">
            {allDates.map((startDate, x) => {
              const weekGroup = _genWeekGroup(startDate);
              const month = _getShowMonth(startDate, x === 0);
              return (
                <>
                  <g transform={`translate(${14 * x}, 0)`}>
                    {weekGroup.map((day, y) => {
                      const fill = data[day] ? colorCalculator(data[day]) : '#ebedf0';
                      return (
                        <Popover
                          content={
                            <span>
                              {moment(day).format('YYYY-MM-DD')}
                              {data[day] ? (
                                <>
                                  共计
                                  <span
                                    style={{
                                      fontWeight: 'bold',
                                      fontSize: '20px',
                                      margin: '0 4px',
                                    }}
                                  >
                                    {data[day]}
                                  </span>
                                  次访问
                                </>
                              ) : (
                                '无访问'
                              )}
                            </span>
                          }
                        >
                          <rect
                            width={10}
                            height={10}
                            x={14 - x}
                            y={13 * y}
                            className={style.rect}
                            style={{
                              fill,
                            }}
                          />
                        </Popover>
                      );
                    })}
                  </g>
                  {month && (
                    <text x={14 + 13 * x} y="-7" className={style.axisLabel}>
                      {month}
                    </text>
                  )}
                </>
              );
            })}
            {['Mon', 'Wed', 'Fri'].map((w, i) => {
              return (
                <text textAnchor="start" className={style.axisLabel} dx="-10" dy={22 + i * 25}>
                  {w}
                </text>
              );
            })}
          </g>
        </svg>
      </div>
      <div className={style.tip}>
        <span className={style.label}>less</span>
        {new Array(5).fill(1).map((item, i) => {
          const fill = colorCalculator(min + ((max - min) * i) / 4);
          return (
            <svg width={10} height={10} style={{ marginRight: '4px' }} key={i}>
              <rect width={10} height={10} rx={2} ry={2} className={style.rect} style={{ fill }} />
            </svg>
          );
        })}
        <span className={style.label}>more</span>
      </div>
    </div>
  );
};

export default HeatChart;
