export const Local_Name = {
    'Future':'Future'
}


class Memory {

}

export const memory = ()=>{

}

class DateKeyStorage {
    /**
     * 生成带日期的键名
     * @param {string} baseKey - 基础键名
     * @param {Date|string} date - 日期对象或日期字符串(YYYY-MM-DD格式)
     * @returns {string} 生成的键名
     */
    generateKey(baseKey, date = new Date()) {
        const dateStr = typeof date === 'string' ? date : 
            date.toISOString().split('T')[0];
        return `${baseKey}_${dateStr}`;
    }
    
    /**
     * 添加数据到指定键和日期的数组中
     * @param {string} baseKey - 基础键名
     * @param {string|string[]} value - 要存储的值或值数组
     * @param {Date|string} date - 日期对象或日期字符串
     * @returns {string[]} 更新后的数组
     */
    add(baseKey, value, date = new Date()) {
        const key = this.generateKey(baseKey, date);
        let data = JSON.parse(localStorage.getItem(key)) || [];
        
        if (typeof value === 'string') {
            data.push(value);
        } else if (Array.isArray(value)) {
            data = data.concat(value);
        }
        
        localStorage.setItem(key, JSON.stringify(data));
        return data;
    }
    
    /**
     * 获取指定键和日期的数据数组
     * @param {string} baseKey - 基础键名
     * @param {Date|string} date - 日期对象或日期字符串
     * @returns {string[]} 存储的数据数组
     */
    get(baseKey, date = new Date()) {
        const key = this.generateKey(baseKey, date);
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : [];
    }

     /**
     * 检查指定字符串是否存在于缓存中
     * @param {string} baseKey - 基础键名
     * @param {string} value - 要检查的字符串
     * @param {Date|string|null} date - 日期对象或日期字符串，如果为null则检查所有日期
     * @returns {boolean} 是否存在
     */
     has(baseKey, value, date = null) {
        if (date === null) {
            // 检查所有日期
            const keys = this.getAllKeys(baseKey);
            for (const key of keys) {
                const data = JSON.parse(localStorage.getItem(key)) || [];
                if (data.includes(value)) {
                    return true;
                }
            }
            return false;
        } else {
            // 检查指定日期
            const key = this.generateKey(baseKey, date);
            const data = JSON.parse(localStorage.getItem(key)) || [];
            return data.includes(value);
        }
    }
    
    /**
     * 清除指定键和日期的数据
     * @param {string} baseKey - 基础键名
     * @param {Date|string} date - 日期对象或日期字符串
     */
    clear(baseKey, date = new Date()) {
        const key = this.generateKey(baseKey, date);
        localStorage.removeItem(key);
    }
    
    /**
     * 获取所有与基础键相关的键名
     * @param {string} baseKey - 基础键名
     * @returns {string[]} 匹配的键名数组
     */
    getAllKeys(baseKey) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(baseKey + '_')) {
                keys.push(key);
            }
        }
        return keys;
    }
    
    /**
     * 获取所有与基础键相关的数据
     * @param {string} baseKey - 基础键名
     * @returns {Object} 键值对对象
     */
    getAll(baseKey) {
        const keys = this.getAllKeys(baseKey);
        const result = {};
        
        keys.forEach(key => {
            result[key] = JSON.parse(localStorage.getItem(key));
        });
        
        return result;
    }
    
    /**
     * 清除所有与基础键相关的数据
     * @param {string} baseKey - 基础键名
     */
    clearAll(baseKey) {
        const keys = this.getAllKeys(baseKey);
        keys.forEach(key => {
            localStorage.removeItem(key);
        });
    }
    
    /**
     * 获取指定日期范围内的数据
     * @param {string} baseKey - 基础键名
     * @param {Date} startDate - 开始日期
     * @param {Date} endDate - 结束日期
     * @returns {Object} 日期范围内的数据
     */
    getDateRange(baseKey, startDate, endDate) {
        const result = {};
        const keys = this.getAllKeys(baseKey);
        
        keys.forEach(key => {
            // 提取键名中的日期部分
            const dateStr = key.split('_').pop();
            const keyDate = new Date(dateStr);
            
            // 检查日期是否在范围内
            if (keyDate >= startDate && keyDate <= endDate) {
                result[key] = JSON.parse(localStorage.getItem(key));
            }
        });
        
        return result;
    }
}