import React, { useEffect } from 'react';
import { navigate } from 'gatsby';

/** 旧路由：找模式 → 酝酿池 */
const FindPatternRedirect = () => {
  useEffect(() => {
    navigate('/quick-calc/brewing-pool', { replace: true });
  }, []);
  return null;
};

export default FindPatternRedirect;
