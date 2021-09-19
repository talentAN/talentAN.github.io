import React from 'react';
import styles from './LayoutWrapper.module.less';

const LayoutWrapper = props => {
  const { title, children } = props;
  return (
    <div className={styles.wrapper}>
      <div className={styles.title}>{title}</div>
      <div className={styles.content}>{children}</div>
    </div>
  );
};

export default LayoutWrapper;
