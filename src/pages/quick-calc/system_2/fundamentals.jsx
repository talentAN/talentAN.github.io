import React, { useEffect } from 'react';
import { navigate } from 'gatsby';

const FundamentalsPage = () => {
  useEffect(() => {
    navigate('/quick-calc/system_2/fundamentals/meta', { replace: true });
  }, []);
  return null;
};

export default FundamentalsPage;
