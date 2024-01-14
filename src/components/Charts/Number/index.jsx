import React, { useRef } from 'react';
import { formatNumber } from '../../../utils/tools';
import * as styles from './index.module.less';

const NumberChart = props => {
  const { data, formatter = formatNumber } = props;
  const dom = useRef();

  return (
    <div ref={dom} className={styles.root}>
      {formatter(data)}
    </div>
  );
};

export default NumberChart;
