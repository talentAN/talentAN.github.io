import React, { useRef } from 'react';
import { formatNumber } from '../../../utils/tools';
import styles from './index.module.less';

const _getFitFontSize = (v, width, height) => {
  let fontSize = Math.min(width / 2, height);
  let size;
  const div = document.createElement('div');
  div.innerHTML = v;
  document.body.appendChild(div);
  const gap = Math.max(v.length, 5);
  do {
    fontSize = fontSize - gap;
    div.setAttribute(
      'style',
      `font-size: ${fontSize}px; visibility:hidden; position:absolute; width:auto; height:auto;`
    );
    size = div.getBoundingClientRect();
  } while (size.height > height * 0.95 || size.width > width * 0.9);
  document.body.removeChild(div);
  return fontSize;
};

const NumberChart = props => {
  const { data } = props;
  const dom = useRef();

  return (
    <div ref={dom} className={styles.root}>
      {formatNumber(data)}
    </div>
  );
};

export default NumberChart;
