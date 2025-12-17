const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

// Firebase Config (已帶入你的資料)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "fuk-bus-trip-6e899",
  databaseURL: "https://fuk-bus-trip-6e899-default-rtdb.asia-southeast1.firebasedatabase.app/", // <-- REPLACE WITH YOUR ACTUAL URL
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

createApp({
    setup() {
        const currentTab = ref('itinerary');
        const activeDay = ref('prep'); // Default to 'prep'
        const loading = ref(true);
        const rates = ref({ JPY: '0.0500', KRW: '0.0058' });

        // const updateRates = async () => {
        //     try {
        //         const [jpyRes, krwRes] = await Promise.all([
        //             fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://www.xe.com/currencyconverter/convert/?Amount=1&From=JPY&To=HKD')),
        //             fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://www.xe.com/currencyconverter/convert/?Amount=1&From=KRW&To=HKD'))
        //         ]);

        //         const jpyData = await jpyRes.json();
        //         const krwData = await krwRes.json();

        //         const jpyMatch = jpyData.contents.match(/1 JPY = ([\d.]+) HKD/);
        //         if (jpyMatch && jpyMatch[1]) {
        //             rates.value.JPY = parseFloat(jpyMatch[1]).toFixed(4);
        //         }

        //         const krwMatch = krwData.contents.match(/1 KRW = ([\d.]+) HKD/);
        //         if (krwMatch && krwMatch[1]) {
        //             rates.value.KRW = parseFloat(krwMatch[1]).toFixed(4);
        //         }
        //     } catch (error) {
        //         console.error("Could not update exchange rates:", error);
        //     }
        // };

        // 核心響應式資料
        const trip_prepList = ref([]);
        const trip_days = ref(Array.from({length: 9}, (_, i) => ({ date: 4+i, events: [] })));
        const trip_expenses = ref([]);
        const trip_shoppingList = ref([]);
        const editingPrepItem = ref(null);
        const weatherForecast = ref({ icon: 'wb_sunny', text: '晴' });

        // Bridge for template bindings expecting `data.*` and `inputs.*`
        const data = computed(() => ({
            prepList: trip_prepList.value,
            days: trip_days.value,
            expenses: trip_expenses.value,
            shoppingList: trip_shoppingList.value
        }));

        const inputs = ref({
            prepText: '',
            prepNote: '',
            prepAddr: '',
            eventTime: '',
            eventTitle: '',
            eventAddr: '',
            eventNote: '',
            expAmount: null,
            expCurrency: 'HKD',
            expType: '食',
            expMethod: 'Cash',
            expNote: '',
            shopName: '',
            shopPrice: '',
            shopCat: 'food',
            shopNote: '',
            shopCurrency: 'JPY',
            shopMap: '',
            shopDate: ''
        });

        // UI 狀態
        const newPrep = ref('');
        const newExp = ref({ amount: null, currency: 'HKD', note: '', type: '食' });

        // 1. 雲端同步：從 Firebase 讀取
        onMounted(async () => {
            //await updateRates();
            db.ref('fuk_bus_data').on('value', (snapshot) => {
                const val = snapshot.val() || {};
                if (Array.isArray(val.prepList)) {
                    trip_prepList.value = val.prepList;
                }
                if (Array.isArray(val.days) && val.days.length > 0) {
                    trip_days.value = val.days;
                }
                if (Array.isArray(val.expenses)) {
                    trip_expenses.value = val.expenses;
                }
                if (Array.isArray(val.shoppingList)) {
                    trip_shoppingList.value = val.shoppingList;
                }
                if (typeof activeDay.value === 'number' && activeDay.value >= trip_days.value.length) {
                    activeDay.value = 0;
                }
                loading.value = false;
            });
        });

        // 2. 雲端同步：手動觸發保存 (當修改資料時)
        const saveToFirebase = () => {
            db.ref('fuk_bus_data').set({
                prepList: trip_prepList.value,
                days: trip_days.value,
                expenses: trip_expenses.value,
                shoppingList: trip_shoppingList.value
            });
        };

        const syncShopItemToEvent = (item, oldDate = null) => {
            // First, remove any existing event linked to this item
            if (oldDate) {
                const oldDayIndex = trip_days.value.findIndex(d => d.date == oldDate);
                if (oldDayIndex !== -1) {
                    const events = trip_days.value[oldDayIndex].events;
                    const eventIndex = events.findIndex(e => e.shopItemId === item.id);
                    if (eventIndex > -1) {
                        events.splice(eventIndex, 1);
                    }
                }
            }

            // Now, add a new event if a date is set
            if (item.date) {
                const dayIndex = trip_days.value.findIndex(d => d.date == item.date);
                if (dayIndex !== -1) {
                    // Ensure events array exists
                    if (!trip_days.value[dayIndex].events) {
                        trip_days.value[dayIndex].events = [];
                    }
                    // Avoid adding duplicates
                    const existingEventIndex = trip_days.value[dayIndex].events.findIndex(e => e.shopItemId === item.id);
                    if (existingEventIndex === -1) {
                         trip_days.value[dayIndex].events.push({
                            time: '12:00', // Default time for shopping events
                            title: `🛍️ ${item.name}`,
                            address: item.map || '',
                            note: item.note || '',
                            shopItemId: item.id // Link to the shopping item
                        });
                    }
                }
            }
        };

        const removeShopItemFromEvent = (item) => {
            if (!item.date) return;
            const dayIndex = trip_days.value.findIndex(d => d.date == item.date);
            if (dayIndex !== -1) {
                const events = trip_days.value[dayIndex].events;
                const eventIndex = events.findIndex(e => e.shopItemId === item.id);
                if (eventIndex > -1) {
                    events.splice(eventIndex, 1);
                }
            }
        };

        // 行程邏輯
        const addPrep = () => {
            const text = inputs.value.prepText?.trim();
            if(text) {
                trip_prepList.value.push({ text, note: inputs.value.prepNote || '', address: inputs.value.prepAddr || '', done: false });
                inputs.value.prepText = '';
                inputs.value.prepNote = '';
                inputs.value.prepAddr = '';
                saveToFirebase();
            }
        };

        const parseFlight = (t) => {
            const m = t.match(/([\w\s]+)\s(\w{3})\s→\s(\w{3})/);
            return m ? { num: m[1], dep: m[2], arr: m[3] } : { num: 'UO600', dep: 'HKG', arr: 'FUK' };
        };

        const addEvent = () => {
            const t = inputs.value.eventTitle?.trim();
            if(!t) return;
            if (typeof activeDay.value !== 'number') return;

            let eventObj = {
                time: inputs.value.eventTime || '00:00',
                title: t,
                address: inputs.value.eventAddr || '',
                note: inputs.value.eventNote || ''
            };

            // Special handling for flights
            if (t.includes('✈️')) {
                const match = t.match(/([\w\s]{2,8})\s*(\w{3})\s*→\s*(\w{3})/);
                if (match) {
                    const [, flightNum, depCode, arrCode] = match;
                    
                    // The title will be constructed in a standard way for consistency
                    eventObj.title = `✈️ ${flightNum.trim()} ${depCode.trim()} → ${arrCode.trim()}`;
                    // The address field for flights is often the airport code
                    eventObj.address = depCode.trim(); 
                }
            }

            if (!trip_days.value[activeDay.value]) {
                trip_days.value[activeDay.value] = { date: 4 + activeDay.value, events: [] };
            }
            // Ensure events array exists
            if (!trip_days.value[activeDay.value].events) {
                trip_days.value[activeDay.value].events = [];
            }
            trip_days.value[activeDay.value].events.push(eventObj);
            
            // Reset inputs
            inputs.value.eventTime = '';
            inputs.value.eventTitle = '';
            inputs.value.eventAddr = '';
            inputs.value.eventNote = '';
            saveToFirebase();
        };

        const editFlight = (dIdx, eIdx) => {
             const ev = data.value.days[dIdx].events[eIdx];
             
             // Parse current details
             const details = getFlightDetail(ev.title);
             const currentDepTime = ev.time;
             const note = ev.note || '';
             const arrTimeMatch = note.match(/(\d{2}:\d{2})/);
             const currentArrTime = arrTimeMatch ? arrTimeMatch[1] : '';

             // Prompt for new details, with current values as defaults
             const newFlightNum = prompt('修改航班號:', details.flightNum);
             const newDepCode = prompt('修改出發地 (3-letter code):', details.depCode);
             const newArrCode = prompt('修改目的地 (3-letter code):', details.arrCode);
             const newDepTime = prompt('修改出發時間 (HH:MM):', currentDepTime);
             const newArrTime = prompt('修改抵達時間 (HH:MM):', currentArrTime);

             // Update the event object if new values were provided
             if (newFlightNum && newDepCode && newArrCode) {
                ev.title = `✈️ ${newFlightNum.trim()} ${newDepCode.trim().toUpperCase()} → ${newArrCode.trim().toUpperCase()}`;
             }
             if (newDepTime) {
                ev.time = newDepTime;
             }
             if (newArrTime) {
                // Preserve other notes if they exist, otherwise create a new note
                const otherNotes = note.replace(/(\d{2}:\d{2}) 抵達/, '').trim();
                ev.note = `${newArrTime} 抵達 ${otherNotes}`.trim();
             } else {
                // If arrival time is cleared, remove it from the note
                ev.note = note.replace(/(\d{2}:\d{2}) 抵達/, '').trim();
             }

             saveToFirebase();
        };

        const deleteEvent = (dayIndex, eventIndex) => {
            if (confirm('刪？')) {
                // Get the correct event from the sorted list
                const eventToDelete = sortedEvents.value[eventIndex];
                if (!eventToDelete) {
                    console.error("Cannot find event to delete.");
                    return;
                }

                // If the event is linked to a shopping item, find that item and clear its date.
                if (eventToDelete.shopItemId) {
                    const shopItem = trip_shoppingList.value.find(item => item.id === eventToDelete.shopItemId);
                    if (shopItem) {
                        shopItem.date = ''; // Unlink by clearing the date
                    }
                }

                // Now, find the event's true index in the original, unsorted array and remove it.
                const originalEvents = trip_days.value[dayIndex].events;
                const indexInOriginalArray = originalEvents.findIndex(event => 
                    // Find by unique ID if it exists
                    (event.shopItemId && event.shopItemId === eventToDelete.shopItemId) ||
                    // Otherwise, find by a combination of properties
                    (event.time === eventToDelete.time && event.title === eventToDelete.title && event.address === eventToDelete.address)
                );
                
                if (indexInOriginalArray !== -1) {
                    originalEvents.splice(indexInOriginalArray, 1);
                    saveToFirebase();
                } else {
                    // As a fallback, try a less strict search. This should rarely be needed.
                    const fallbackIndex = originalEvents.indexOf(eventToDelete);
                    if (fallbackIndex > -1) {
                        originalEvents.splice(fallbackIndex, 1);
                        saveToFirebase();
                    } else {
                        alert('無法刪除該項目，請刷新後再試。');
                    }
                }
            }
        };

        // 記帳邏輯
        const addExpense = () => {
            const amt = Number(inputs.value.expAmount);
            if(amt && amt > 0) {
                trip_expenses.value.push({
                    amount: amt,
                    currency: inputs.value.expCurrency,
                    type: inputs.value.expType,
                    method: inputs.value.expMethod,
                    note: inputs.value.expNote || ''
                });
                inputs.value.expAmount = null;
                inputs.value.expNote = '';
                saveToFirebase();
            }
        };

        const totalExpenseHKD = computed(() => {
            return trip_expenses.value.reduce((sum, item) => {
                let rate = 1;
                if(item.currency === 'JPY') rate = rates.value.JPY;
                if(item.currency === 'KRW') rate = rates.value.KRW;
                return sum + (item.amount * rate);
            }, 0).toFixed(0);
        });

        // Alias for template using `expenses`
        const expenses = computed(() => trip_expenses.value);

        // 圖表渲染
        let chart = null;
        const renderChart = () => {
            const ctx = document.getElementById('expenseChart');
            if(!ctx) return;
            if(chart) chart.destroy();
            chart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    datasets: [{ 
                        data: trip_expenses.value.map(e => e.amount), 
                        backgroundColor: ['#0EA5E9', '#F59E0B', '#EF4444', '#10B981'] 
                    }]
                },
                options: { cutout: '70%', plugins: { legend: { display: false } } }
            });
        };

        watch(currentTab, (val) => { if(val==='accounting') nextTick(renderChart); });

        // Helpers referenced by template
        const formatLink = (text) => {
            if(!text) return '';
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" class="text-sky-600 underline">${url}</a>`);
        };
        const getExpenseIconName = (t) => {
            const map = { '食': 'restaurant', '交通': 'train', '購物': 'shopping_bag', '住宿': 'hotel', '其他': 'receipt' };
            return map[t] || 'payments';
        };

        const getMapSearchUrl = (event) => {
            // Prioritize address if it's specific. Otherwise, use the event title.
            // A simple heuristic: if address is more than just a city name, it's likely specific.
            const query = (event.address && event.address.length > 5) 
                ? event.address 
                : event.title.replace('✈️', '').replace('🛍️', '').trim();
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
        };

        const getFlightDetail = (title) => {
            const match = title.match(/([\w\s]{2,8})\s*(\w{3})\s*→\s*(\w{3})/); 
            
            if (!match) return { flightNum: 'N/A', depCode: 'TBA', arrCode: 'TBA', depTime: 'TBA', arrTime: 'TBA' };

            const [fullMatch, flightNum, depCode, arrCode] = match;
            
            const currentEvent = data.value.days[activeDay.value]?.events.find(e => e.title === title);
            
            const depTime = currentEvent ? currentEvent.time : 'TBA';
            const note = currentEvent ? currentEvent.note : '';
            const arrTimeMatch = note ? note.match(/(\d{2}:\d{2}) 抵達/) : null;
            const arrTime = arrTimeMatch ? arrTimeMatch[1] : 'TBA';

            return {
                flightNum: flightNum.trim(),
                depCode: depCode.trim(),
                arrCode: arrCode.trim(),
                depTime: depTime,
                arrTime: arrTime
            };
        };
        const allLocations = computed(() => {
            const locs = [];
            
            // Add locations from prep list
            data.value.prepList.forEach(item => {
                if (item.address) {
                    locs.push({
                        title: item.text,
                        address: item.address,
                        dayNum: 'Prep',
                        city: '準備'
                    });
                }
            });

            locs.push({ title: '福岡酒店', address: 'Richmond Hotel Fukuoka Tenjin', dayNum: '1-4', city: '福岡' });
            locs.push({ title: '釜山酒店', address: 'UH suite 유에이치스위트 더 해운대', dayNum: '5-9', city: '釜山' }); 

            data.value.days.forEach((day, idx) => {
                if (day && Array.isArray(day.events)) {
                    day.events.forEach(ev => {
                        if (ev.address && ev.address.length > 3 && !['HKG','FUK','PUS','UH suite 유에이치스위트 더 해운대'].includes(ev.address) && !locs.some(l => l.address === ev.address)) {
                            locs.push({
                                title: ev.title.replace('✈️', '').trim(),
                                address: ev.address,
                                dayNum: idx + 1,
                                city: getCityByDay(idx)
                            });
                        }
                    });
                }
            });
            return locs;
        });
        const getCityByDay = (dayIndex) => {
            // Simple mapping: first 4 days Fukuoka, rest Busan
            return dayIndex < 4 ? '福岡' : '釜山';
        };
        
        const getDayOfWeek = (date) => {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            // January 4, 2026 is a Sunday. Date '4' corresponds to index 0 (Sunday).
            const dayIndex = (date - 4) % 7;
            return dayNames[dayIndex];
        };

        const editPrepItem = (index) => {
            editingPrepItem.value = { ...trip_prepList.value[index], originalIndex: index };
        };
        const savePrepItem = () => {
            if (!editingPrepItem.value) return;
            const { originalIndex, ...updatedItem } = editingPrepItem.value;
            trip_prepList.value[originalIndex] = updatedItem;
            saveToFirebase();
            editingPrepItem.value = null;
        };
        const cancelEditPrep = () => {
            editingPrepItem.value = null;
        };

        const updateWeather = async (dayIndex) => {
            if (typeof dayIndex !== 'number') {
                weatherForecast.value = { icon: 'help_outline', text: 'N/A' };
                return;
            }
            const city = getCityByDay(dayIndex);
            const date = trip_days.value[dayIndex]?.date;
            if (!city || !date) return;

            const year = 2026; // Assuming the trip is in 2026
            const month = '01';
            const day = String(date).padStart(2, '0');
            const fullDate = `${year}-${month}-${day}`;

            try {
                // Use a proxy to avoid CORS issues if running locally
                const response = await fetch(`https://wttr.in/${city}?format=j1`);
                if (!response.ok) throw new Error('Weather data not available');
                
                const weatherData = await response.json();
                const dayWeather = weatherData.weather.find(d => d.date === fullDate);

                if (dayWeather) {
                    // Get weather from noon (12:00) for a representative forecast
                    const noonForecast = dayWeather.hourly.find(h => h.time === "1200");
                    if (noonForecast) {
                        const weatherDesc = noonForecast['lang_zh-tw']?.[0]?.value || noonForecast.weatherDesc[0].value;
                        let icon = 'wb_sunny';
                        if (weatherDesc.includes('雨')) icon = 'rainy';
                        else if (weatherDesc.includes('雲') || weatherDesc.includes('陰')) icon = 'cloud';
                        else if (weatherDesc.includes('雪')) icon = 'ac_unit';
                        
                        weatherForecast.value = { icon, text: weatherDesc };
                    }
                } else {
                     weatherForecast.value = { icon: 'help_outline', text: '無資料' };
                }
            } catch (error) {
                console.error("Failed to fetch weather:", error);
                weatherForecast.value = { icon: 'error_outline', text: '讀取失敗' };
            }
        };

        watch(activeDay, (newDay) => {
            if (newDay !== 'prep') {
                updateWeather(newDay);
            }
        }, { immediate: true });

        const sortedEvents = computed(() => {
            const dayIndex = activeDay.value;
            if (typeof dayIndex !== 'number' || !trip_days.value[dayIndex] || !Array.isArray(trip_days.value[dayIndex].events)) {
                return [];
            }
            // Create a copy before sorting to avoid mutating the original array
            return [...trip_days.value[dayIndex].events].sort((a, b) => {
                return a.time.localeCompare(b.time);
            });
        });

        const editEvent = () => {};

        const selectDay = (d) => {
            // Allow 'prep' or numeric index
            activeDay.value = d === 'prep' ? 'prep' : Number(d) || 0;
        };
         // Shopping List Logic
        const filteredShopList = computed(() => {
            if (shopFilter.value === 'all') {
                return trip_shoppingList.value;
            }
            return trip_shoppingList.value.filter(item => item.category === shopFilter.value);
        });
        const shopFilter = ref('all');
        const mapEmbedSrc = ref('https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d209121.78508103348!2d130.26442436034098!3d33.64964177218671!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x354191c7e6f9b3e5%3A0x1c48011116c2763!2sFukuoka%2C%20Fukuoka%20Prefecture%2C%20Japan!5e0!3m2!1sen!2stw!4v1700000000000!5m2!1sen!2stw');
        const updateMap = (address) => {
            mapEmbedSrc.value = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
        };
        return {
            currentTab, activeDay, loading, rates,
            allLocations, trip_days, trip_prepList, trip_expenses,
            data, inputs, expenses, mapEmbedSrc,
            weatherForecast,
            navTabs: [
                { id: 'itinerary', label: '行程', icon: 'calendar_month' },
                { id: 'map', label: '地圖', icon: 'map' },
                { id: 'accounting', label: '記帳', icon: 'pie_chart' },
                { id: 'shopping', label: '清單', icon: 'shopping_bag' },
                { id: 'info', label: '資訊', icon: 'info' }
            ],
            newPrep, newExp, addPrep, saveToFirebase, parseFlight, addEvent, deleteEvent,
            totalExpenseHKD, addExpense, updateMap,
            getExpIcon: (t) => 'restaurant_menu', getExpenseIconName, getMapSearchUrl,
            deleteExpense: (i) => { trip_expenses.value.splice(i,1); saveToFirebase(); },
            deleteItem: (type, i) => { trip_prepList.value.splice(i,1); saveToFirebase(); },
            formatLink, getFlightDetail, getCityByDay, getDayOfWeek, editEvent, selectDay,
            sortedEvents,
            // Prep List edit
            editingPrepItem, editPrepItem, savePrepItem, cancelEditPrep,
            // Shopping List additions
            shopFilter, 
            filteredShopList,
            addShopItem: () => {
                if(inputs.value.shopName) {
                    const newItem = {
                        id: Date.now(), // Unique ID for the item
                        name: inputs.value.shopName,
                        price: inputs.value.shopPrice || 0,
                        currency: inputs.value.shopCurrency,
                        category: inputs.value.shopCat,
                        note: inputs.value.shopNote,
                        map: inputs.value.shopMap,
                        date: inputs.value.shopDate,
                        done: false
                    };
                    trip_shoppingList.value.push(newItem);

                    // Sync with events if date is present
                    if (newItem.date) {
                        syncShopItemToEvent(newItem);
                    }

                    inputs.value.shopName = '';
                    inputs.value.shopPrice = '';
                    inputs.value.shopNote = '';
                    inputs.value.shopMap = '';
                    inputs.value.shopDate = '';
                    saveToFirebase();
                }
            },
            editShopItem: (item) => {
                // Store old values for finding the expense and event later
                const oldPrice = item.price;
                const oldName = item.name;
                const oldCurrency = item.currency;
                const oldDate = item.date;

                const newName = prompt('修改項目名稱:', item.name);
                const newPrice = prompt('修改項目價格:', item.price);
                const newCurrency = prompt('修改貨幣 (HKD, JPY, KRW):', item.currency);
                const newNote = prompt('修改備註:', item.note);
                const newMap = prompt('修改地圖/地址:', item.map || '');
                const newDate = prompt('修改日期 (e.g., 4-12):', item.date || '');


                // Find the expense item *before* updating the shopping item
                let expenseIndex = -1;
                if (item.done) {
                    const expenseNote = `[清單] ${oldName}`;
                    expenseIndex = trip_expenses.value.findIndex(exp =>
                        exp.note === expenseNote &&
                        exp.amount === Number(oldPrice) &&
                        exp.currency === oldCurrency &&
                        exp.type === '購物'
                    );
                }

                // Update shopping item
                if (newName) item.name = newName;
                if (newPrice !== null) item.price = Number(newPrice);
                if (newCurrency) item.currency = newCurrency.toUpperCase();
                if (newNote !== null) item.note = newNote;
                if (newMap !== null) item.map = newMap;
                if (newDate !== null) item.date = newDate;

                // Sync with events
                syncShopItemToEvent(item, oldDate);

                // If it was done, update the corresponding expense item
                if (item.done && expenseIndex > -1) {
                    const expenseItem = trip_expenses.value[expenseIndex];
                    expenseItem.amount = item.price;
                    expenseItem.currency = item.currency;
                    expenseItem.note = `[清單] ${item.name}`;
                }

                saveToFirebase();
            },
            deleteShopItem: (item) => {
                const i = trip_shoppingList.value.indexOf(item);
                if (i > -1 && confirm('確定刪除此清單項目？')) {
                    // Remove from events first
                    removeShopItemFromEvent(item);

                    // If the item was done, remove its corresponding expense
                    if (item.done) {
                        const expenseNote = `[清單] ${item.name}`;
                        const expenseIndex = trip_expenses.value.findIndex(exp =>
                            exp.note === expenseNote &&
                            exp.amount === Number(item.price) &&
                            exp.currency === item.currency &&
                            exp.type === '購物'
                        );
                        if (expenseIndex > -1) {
                            trip_expenses.value.splice(expenseIndex, 1);
                        }
                    }
                    // Then remove the item from the shopping list
                    trip_shoppingList.value.splice(i, 1);
                    saveToFirebase();
                }
            },
            toggleShopDone: (item) => {
                item.done = !item.done;
                const expenseNote = `[清單] ${item.name}`;

                if (item.done && item.price > 0) {
                    // Add expense when checked
                    trip_expenses.value.push({
                        amount: Number(item.price),
                        currency: item.currency,
                        type: '購物',
                        method: 'Cash', // Or another default
                        note: expenseNote
                    });
                } else {
                    // Remove expense when unchecked
                    const expenseIndex = trip_expenses.value.findIndex(exp =>
                        exp.note === expenseNote &&
                        exp.amount === Number(item.price) &&
                        exp.currency === item.currency &&
                        exp.type === '購物'
                    );
                    if (expenseIndex > -1) {
                        trip_expenses.value.splice(expenseIndex, 1);
                    }
                }
                saveToFirebase();
            },
            editItem: (type, idx) => { const newVal = prompt('修改:', data.value.prepList[idx].text); if(newVal) data.value.prepList[idx].text = newVal; },
            // Flight edit
            editFlight
        }
    }
}).mount('#app');
